# Model Agnostic Context TS Lib (WIP):
- Purpose: Allows any LLM to be able to use ‘tools’ and other resources, to provide dynamic context for answering prompts intelligently. 

- Note: Some LLM providers like OpenAI already support tool use through their API as a separate parameter, however, my goal is to allow the use of tools and other resources through any LLM, regardless of the feature set offered by their providers. 

- This library takes inspiration from the model context protocol in the way how dynamic schemas are defined and validated for tools and other resources available to the model.

- This library focuses on an embedded approach to model context injection. Instead of using a client-server communication model, this library encapsulates all communication between the LLM and your code —eliminating the hassle of dealing with rpc messaging, sockets, and authentication. 

## Why MAC?
- **Ensure interoperability** across different LLM providers.
- **Maintain security** by adhering to CIA (Confidentiality, Integrity, Availability) principles.
- **Guarantee type safety** in interactions between models and tools.
- **Provide deterministic behavior** when executing model-assisted tasks.

## How It Works
1. A user submits a prompt from a client.
2. The prompt is sent to a server where it is combined with:
   - Server-side context (agent role, guidelines, etc.).
   - Available tool context.
   - Schema information.
   - Response structuring details.
3. The enriched prompt is sent to the LLM.
4. The LLM determines if the request can be fulfilled:
   - If **not possible**, a fallback response is generated.
   - If **possible**, the LLM returns a structured JSON containing tool calls and parameters.
5. The JSON is parsed and **validated using Zod** for type safety.
6. If errors occur at any stage:
   - The LLM is reprompted to fix the error.
   - If retries fail, a fallback response is returned.
7. If all checks pass, the tools execute their functions.
8. If additional context is required then follow-up prompts are recursively executed.
9. When enough context is gathered, a structured response is sent to the client with the final desired output.

## Features
- **Model-Agnostic** – Works with any LLM that supports structured responses.
- **Type-Safe** – Uses **Zod** for runtime validation.
- **Fallback Handling** – Ensures a graceful response when errors occur.
- **Deterministic Execution** – Ensures tool calls are executed correctly.
- **Extensible & Modular** – Easily integrate new tools and transformations.

## Overview:

- The 'Model agnostic context (MAC)' library allows you to specify ‘bridges’ for interacting with the LLMs of your choice. In a callback function, you simply expose the LLM’s response API function, pass in the required input parameters, and return the response like normal. Additionally a completion handler is required; here the final response from the LLM will be received (either an error or the requested generated content (images, text, audio etc)). In the completion handler everything is in your ballpark and you can do whatever you want with the content you receive. 

```typeScript
const client = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });
```

```typeScript
const openAIBridge = new LLMBridge({
        name: "Open-AI",
        promptExecutor: async (promptInput: MacInput) => {
            const response = await client.responses.create({
                model: "gpt-4",
                input: promptInput.input
            });

            return {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: response.output_text
                },
                error: response.error?.message
            };
        },
        completionHandler: (output: MacOutput) => {
            console.log(output);
        }
    });
```

- To create tools for the LLM to use you simply specify a name for the tool, a description (optional), a schema for the expected parameters to be passed to the tools, and a dedicated callback function. Callback functions contain the business logic you want to invoke using the dynamic parameters selected by the LLM.

```typeScript
const mac = new Mac(openAIBridge);
```

```typeScript
mac.addTool({
        name: "weather-checker",
        description: "Check the weather in any city and state in the United States",
        paramsSchema: {
            city: z.string(),
            state: z.string()
        },
        responseSchema: WeatherResultSchema.shape,
        callback: async (args: { city: string, state: string }) => {
            async function getCoords(args: { city: string, state: string }): Promise<{ lat: number; lon: number }> {
                const location = encodeURIComponent(`${args.city}, ${args.state}`);
                const geoRes = await fetch(`https://geocode.maps.co/search?q=${location}`);
                const geoData: GeoResult[] = await geoRes.json();

                if (!geoData.length) {
                    throw new Error("Location not found.");
                }

                const res = GeoResultSchema.parse(geoData[0]);

                return {
                    ...res
                };
            }

            async function getWeather(lat: number, lon: number): Promise<WeatherResult> {
                const weatherRes = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
                );
                const weatherData: WeatherResult = await weatherRes.json();
                return weatherData;
            }

            const { lat, lon } = await getCoords(args);
            const weather = await getWeather(lat, lon);

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(weather)
                    }
                ]
            };
        }
    });
```

- For LLM bridges, you can create multiple bridges that can be dynamically switched between on the fly. All of the LLM bridges you define are registered under a special manager class called an orchestrator. Do note that there can be only one orchestrator for each model agnostic context (Mac) instance. 

- The orchestrator class holds the primary logic for interacting with a selected LLM bridge —providing tools, policies, and other information as context into each prompt. 

- The orchestrator allows all LLM bridges access to the same tools, policies, and data, effectively creating a common fabric between the different implementations. Within the orchestrator is a registry for the different tools and bridges. Whenever you want to add a tool or bridge to the orchestrator you first interact with the Mac interface instance. When a tool is added it’s first checked to ensure that it is unique; any duplicate tools or bridges are rejected —adding tools/bridges does not overwrite previous definitions of those entities under the same name. 

- As mentioned briefly before, you can specify policies to inject into each prompt as guidelines for the LLM agent to abide by. There are default policies already applied requiring the LLM to follow any custom policies, and to fail gracefully if the user’s prompt can’t be answered using the available tools / if the prompt violates the policies described.

- In this library you can create policies to add constraints to your agent and completely customize the way it behaves using rule-based logic. To define policies you can build them using the policy builder and add them to the orchestrator via the Mac interface. After adding policies you must then activate them by name or by tag(s) (optional). 

```typeScript
const noForecastFabricationPolicy = new PolicyBuilder()
        .setName("No Forecast Fabrication")
        .setDescription("The assistant must never generate fictional or estimated weather forecasts.")
        .setTags(["weather", "LLM-guidance", "integrity"])
        .setRule(`
            If accurate weather data is unavailable, respond clearly that the forecast cannot be retrieved at this time. 
            Do not generate fictional or estimated forecasts under any circumstances.
        `)
        .build();

    const includeLocationContextPolicy = new PolicyBuilder()
        .setName("Always Include Location Context")
        .setDescription("Ensure all weather responses clearly state the location they pertain to.")
        .setTags(["weather", "LLM-guidance", "clarity"])
        .setRule(`
            Every weather-related response must explicitly include the name of the city or region the forecast is for. 
            If the location is unclear from the prompt, ask the user to clarify before generating a forecast.
        `)
        .build();

    const dataSourcePolicy = new PolicyBuilder()
        .setName("Always Cite Weather Data Sources")
        .setDescription("Instructs the agent to mention the origin of the weather data being reported, improving trust and transparency.")
        .setTags(["weather", "transparency", "trust", "data-source"])
        .setRule(`
            Whenever you provide a weather forecast or climate information, cite the data source (e.g., 'According to NOAA', 'Based on data from OpenWeather', etc.).
            If no source is available, acknowledge it by saying: "Data source not specified."
        `)
        .build();

    mac.addPolicies([
        noForecastFabricationPolicy,
        includeLocationContextPolicy,
        dataSourcePolicy]
    );

    mac.setActivePoliciesWithNames([
        noForecastFabricationPolicy.name,
        includeLocationContextPolicy.name,
        dataSourcePolicy.name
    ]);
```

- The Mac orchestrator contains a policy manager where all policies are stored and managed. Note: the policy manager has default system level policies already applied to constrain the LLM's response within expected boundaries for deterministic response structuring and rule-based reasoning. These policies are always active, and they cannot be overridden by the custom policies you define. However, these system policies won't interfere with any custom policies you add.

## How does this library craft context aware prompts?

1. Mac is a very interesting library. When it comes to crafting context aware prompts, it first sends out a discovery prompt. The discovery prompt allows the LLM to discover that it’s an agent, what its purpose is, what tools / resources are available to it, what policies it should abide by, the schema of the responses it should send back, and how to fail gracefully. The discovery prompt essentially snaps the LLM into an agentic / tool mode.

2. From the discovery prompt, a response is generated either specifying an error with a custom message, or the LLM selects the tools it wants to use, plus the parameters it wants to pass to those tools. 

3. The designated tool handlers in the orchestrator are then triggered and passed the parameters the LLM selected. From here the tools either generate an expected response or an error. On success a follow up prompt is invoked using the context provided by the tool’s response. Here the tool’s response is highlighted within the structured context fed to the LLM. Additionally, the LLM is asked if additional tools are required to finish answering the prompt. If additional tools are required then the tool response context is forward fed into another follow up prompt as a list of actions and results. When the LLM finally decides that it doesn’t need additional tooling and that it can answer the user’s prompt fully, then a response is generated with an array of content (text, image, audio etc). In some special cases, if the LLM encounters an error or does not think it can answer the user’s prompt with the available context and tooling then it fails gracefully with a verbose and custom message. 

### Prompt execution flow:
1. Discovery Prompt (You are an agent, you can use these tools, blah blah)
|
(Response (tool request | error))
|
2. <n> Follow up context-aware prompt (Tool request (if any), tool response data, context specifying the presence of the tool outputs and their hierarchy as a chain of actions)
|
(Needs more tooling?)
|
Yes -  (2 again)
|
No 
|
(Final response generated, send content to completion handler for LLM bridge)

```typeScript
// Content Schemas
export const TextContentSchema = z.object({
    type: z.literal("text"),
    text: z.string()
})
    .passthrough();

export const ImageContentSchema = z.object({
    type: z.literal("image"),
    text: z.string()
})
    .passthrough();

export const AudioContentSchema = z.object({
    type: z.literal("audio"),
    text: z.string()
})
    .passthrough();

const actionLogSchema = z.object({
    type: z.enum(["Tool-Request", "Resource-Request"]),
    name: z.string().optional(),
    arguments: z.record(z.unknown()),
    timeExecuted: z.number(),
    response: z.array(
        z.union([
            TextContentSchema,
            ImageContentSchema,
            AudioContentSchema
        ])
    ),
    isError: z.boolean().default(false).optional()
});

// Tools
export const ToolSchema = z.object({
    /**
     * Name / identifier of the tool
     */
    name: z.string(),
    /**
     * Human-readable description of the tool and its purpose/functionality
     */
    description: z.optional(z.string()),
    inputSchema: z.object({
        type: z.literal("object"),
        /**
         * JSON schema object outlining expected tool parameters
         */
        properties: z.optional(z.object({}).passthrough())
    }).passthrough(),
    responseSchema: z.object({
        type: z.literal("object"),
        /**
         * JSON schema object outlining expected tool parameters
         */
        properties: z.optional(z.object({}).passthrough())
    }).passthrough() // Allows object schema to preserve properties that are not explicitly defined within the schema itself
})
    .passthrough();

/**
 * Request by the LLM to invoke a tool
 */
export const ToolInvocationRequestSchema = z.object({
    name: z.string(),
    // Validated with tool specific schema
    arguments: z.record(z.unknown())
});

/**
 * Response to an executed tool request by the LLM
 */
export const ToolInvocationResultSchema = z.object({
    content: z.array(
        z.union([
            TextContentSchema,
            ImageContentSchema,
            AudioContentSchema
        ])
    ),
    isError: z.boolean().default(false).optional()
});

export type ToolCallback<ParamArgs extends undefined | ZodRawShape = undefined> =
    ParamArgs extends ZodRawShape
    ? (
        args: z.objectOutputType<ParamArgs, ZodTypeAny>
    ) => ToolInvocationResult | Promise<ToolInvocationResult>
    : () => ToolInvocationResult | Promise<ToolInvocationResult>;

export type RegisteredTool = {
    description?: string;
    inputSchema?: AnyZodObject;
    responseSchema?: AnyZodObject;
    callback: ToolCallback<undefined | ZodRawShape>;
};
```

Note: No need to specify the schema for each tool, the available tool context will be provided in every prompt, the LLM can simply search through the context to cross reference the tool via name.

- tool responses can be one of four possible data types: text, image, audio, or blob (for simplicity’s sake i’m going to only support text for right now)

- Each tool response will be maintained within an array. The ordering of the array makes chronological sense, but each response object has an execution time tied to it to specify the order of each action. This array allows the LLM to keep track of its choices in a way that makes sense, to prevent hallucinations, keep track of progress when problem solving, and come to a conclusion after a multi-step / multi-prompt problem solving session. Usually LLMs have a hard time solving problems effectively between multiple prompts, they often lose focus and generate unnecessary information, so keeping the LLM account is important.

## Constraints 
- Finally, when it comes to controlling this entire process and preventing runaway processes and action chains you can define a timeout for tools, and a maximum action chain length. 

- By default the maximum timeout for tools is 10 seconds as some servers timeout after a short period of time. But, if you have a long lived / persistent instance then this value can be changed freely to accommodate compute intensive processes that naturally take a long time to finish ~ image processing.

- For action chains, the default maximum length is 10. This is an arbitrary decision and is meant to prevent excessive querying of LLM bridges. Realistically, most prompt chains created by this library shouldn’t go past 1 digit unless you’re using the library to do a complex task like coding an application, creating file directories, and deploying a repo. 

- Both of these properties act as direct failsafes to ensure maximal controllability in this dynamic environment driven freely by an LLM. 

### Basic Synopsis of the main features of this library:
- User defined tools, policies, & LLM bridges 
- Agent posturing
- Exhaustive error handling
- Runaway action failsafes 
- Structured responses
- Action chaining   