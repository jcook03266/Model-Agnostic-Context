import LLMBridge from "../bridge/llmbridge";
import {
    z,
    ZodRawShape
} from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
    ToolInvocationResult,
    RegisteredTool,
    ToolCallback,
    ToolInvocationRequest,
    MACError,
    ErrorCode,
    MacDiscoveryOutputSchema,
    ActionLog,
    LLMContextAwareOutputSchema,
    ContextAwarePrompt,
    DiscoveryPrompt,
    LLMMessageSchema
} from "../shared/types";
import PolicyManager from "../policy-manager/policyManager";

class Orchestrator {
    static instance: Orchestrator = new Orchestrator();

    // Constraints
    policyManager: PolicyManager = new PolicyManager();
    // Default is 10 consecutive actions
    maxActionChainLength = 10;

    // Tools
    private _registeredTools: { [name: string]: RegisteredTool } = {};

    // Bridges
    private _registeredBridges: { [name: string]: LLMBridge } = {};
    private _currentBridge?: LLMBridge

    // Logging
    private _actionLogs: ActionLog[] = [];

    registerBridge(bridge: LLMBridge): void {
        if (this._registeredBridges[bridge.name]) {
            throw new Error(`Bridge: ${bridge.name} is already registered.`);
        }

        this._registeredBridges[bridge.name] = bridge;
    }

    set currentBridge(name: string) {
        const bridge: LLMBridge | undefined = this._registeredBridges[name];

        if (!bridge) throw new Error(`Bridge: ${name} is not a registered bridge.`);
        else this._currentBridge = bridge;
    }

    get currentBridge(): string | undefined {
        return this._currentBridge?.name;
    }

    /**
     * Soft copy of bridge registry
     */
    get bridges(): { [name: string]: LLMBridge } {
        return { ...this._registeredBridges };
    }

    removeBridge(name: string) {
        if (!this._registeredBridges[name])
            throw new Error(`Bridge: ${name} is not a registered bridge.`);

        // Unset current bridge
        if (this.currentBridge == name) this._currentBridge = undefined;

        // Deregister the bridge
        delete this._registeredBridges[name];

        // Set new bridge from the available pool as an auto fallback
        if (!this.currentBridge && Object.keys(this.bridges).length > 1) {
            this.currentBridge = Object.keys(this.bridges)[0];
        }
    }

    // Prompt Execution
    async executePrompt(targetBridge: string, basePrompt: string): Promise<void> {
        const bridge = this.bridges[targetBridge];

        // Pre-prompt setup
        this.clearActionLogs();

        if (!bridge) {
            throw new MACError(
                ErrorCode.BridgeMissing,
                `Can't process prompt, no registered bridge has been selected.`
            );
        }

        try {
            const firstToolRequest = (await this.discoveryPrompt(bridge, basePrompt));

            if (firstToolRequest) {
                await this.contextAwarePrompt(bridge, basePrompt, firstToolRequest);
            }
        }
        catch (e) {
            console.error(e);
        }
    }

    async discoveryPrompt(
        bridge: LLMBridge,
        basePrompt: string
    ): Promise<ToolInvocationRequest | undefined> {
        const discoveryPromptStructure: DiscoveryPrompt = {
            task: `
            Generate a structured JSON response to the given prompt using the given checklist, policies, context, and available tools. 
            The tool you select will invoked for you using the parameters you choose, and the resulting data will be fed 
            back to you as context in a follow-up prompt.
            `,
            checklist: [
                "Follow the system policies",
                "Can the user's prompt be answered in accordance with the policies described? (if any)",
                "Are the available tools sufficient enough to answer the prompt?",
                "Can the user's prompt be answered without exceeding the maximum allowed amount of sequential actions (e.g. tool requests)?",
                "If a valid response is not possible fail gracefully and generate a descriptive error message for the end user.",
                "If a valid response is possible then select the tool you wish to use, and provide the parameters you wish to plug in for them."
            ],
            maxSequentialActions: this.maxActionChainLength,
            systemPolicies: this.policyManager.systemPoliciesToString(),
            userPolicies: this.policyManager.activePoliciesToString(),
            tools: this.registeredToolsToString(),
            responseSchema: zodToJsonSchema(MacDiscoveryOutputSchema),
            errorCodes: ErrorCode,
            promptToAnswer: basePrompt
        };

        const res = await bridge.promptExecutor({
            input: JSON.stringify(discoveryPromptStructure)
        });

        // Discovery prompt failed, return early
        if (res.error) {
            bridge.completionHandler(res);
            return;
        }

        const llmMessage = LLMMessageSchema.safeParse(res),
            parsedResponse = llmMessage.data ? JSON.parse(llmMessage.data?.content.text) : undefined,
            discoveryOutput = MacDiscoveryOutputSchema.safeParse(parsedResponse),
            output = discoveryOutput.data;

        if (discoveryOutput.error) {
            bridge.completionHandler({
                error: discoveryOutput.error.message
            });
            return;
        }

        // Possible responses from the LLM
        const error = output?.error,
            toolRequest = output?.toolInvocationRequest;

        // Custom error message generated
        if (error) {
            bridge.completionHandler({ error: error.errorMessage });
        }
        // Tool request valid
        else if (toolRequest) {
            return toolRequest;
        }
        // Parsing error occurred
        else {
            bridge.completionHandler({
                ...res,
                error: `Internal error encountered. Error Code: ${ErrorCode.InvalidResponse}`
            });
        }

        return;
    }

    async contextAwarePrompt(
        bridge: LLMBridge,
        basePrompt: string,
        toolRequest: ToolInvocationRequest
    ): Promise<void> {
        if (this._actionLogs.length > this.maxActionChainLength) {
            throw new MACError(
                ErrorCode.MaxActionChainLengthExceeded,
                `Maximum action chain length exceeded, increase limit.`
            );
        }

        // Tool invoked
        const toolResponse = await this.handleToolRequest(toolRequest);

        // Update action log
        this._actionLogs.push({
            type: 'Tool-Request',
            name: toolRequest.name,
            arguments: toolRequest.arguments,
            timeExecuted: Date.now(),
            response: toolResponse.content,
            isError: toolResponse.isError
        });

        if (toolResponse.isError) {
            bridge.completionHandler({
                error: `Internal error encountered. Error Code: ${ErrorCode.InvalidToolResponse}`
            });
            return;
        }

        // Follow-up prompt
        const contextAwarePromptStructure: ContextAwarePrompt = {
            task: `
            The resources you've selected have been executed and their data is available in the 'actionsTaken' field. 

            Using the available context, generate a structured JSON response to the given prompt. Follow the 
            checklist and policies. If the data and context provided is enough to answer the 'promptToAnswer' field then answer it
            in the expected format. If the given context isn't enough then you can perform another tool request using the available tools,
            if necessary.
            `,
            actionsTaken: this.actionLogsToString(),
            checklist: [
                "Follow the system policies",
                "Can the user's prompt be answered in accordance with the policies described? (if any)",
                "Can the user's prompt be answered without exceeding the maximum allowed amount of sequential actions (e.g. tool requests)?",
                "Is the available context enough to answer the prompt? If so then answer it.",
                "If a valid response is not possible fail gracefully and generate a descriptive error message for the end user.",
                "If more context is needed and the available tools are adequate, then select the tool you want to use, and provide the parameters you wish to plug in.",
            ],
            maxSequentialActions: this.maxActionChainLength,
            systemPolicies: this.policyManager.systemPoliciesToString(),
            userPolicies: this.policyManager.activePoliciesToString(),
            tools: this.registeredToolsToString(),
            responseSchema: zodToJsonSchema(LLMContextAwareOutputSchema),
            errorCodes: ErrorCode,
            promptToAnswer: basePrompt
        };

        const res = await bridge.promptExecutor({
            input: JSON.stringify(contextAwarePromptStructure)
        });

        // Follow-up prompt failed for some reason, return early
        if (res.error) {
            bridge.completionHandler(res);
            return;
        }

        const llmMessage = LLMMessageSchema.safeParse(res),
            parsedResponse = llmMessage.data ? JSON.parse(llmMessage.data?.content.text) : undefined,
            contextAwareOutput = LLMContextAwareOutputSchema.safeParse(parsedResponse),
            output = contextAwareOutput.data;

        if (contextAwareOutput.error) {
            bridge.completionHandler({
                error: contextAwareOutput.error.message
            });
            return;
        }

        // Possible responses from the LLM
        const error = output?.error,
            nextToolRequest = output?.toolInvocationRequest,
            embeddedContentResponse = output?.embeddedContentResponse,
            content = output?.content;

        // Custom error message generated
        if (error) {
            bridge.completionHandler({ error });
        }
        // Another tool has been requested
        else if (nextToolRequest) {
            return this.contextAwarePrompt(bridge, basePrompt, nextToolRequest);
        }
        // Sufficient context, final output 
        else if (content || embeddedContentResponse) {
            bridge.completionHandler(output);
        }
        // Parsing error occurred
        else {
            bridge.completionHandler({
                error: `Internal error encountered. Error Code: ${ErrorCode.InvalidResponse}`
            });
        }

        return;
    }

    // Tools
    /**
    * - Overloaded functions for register tool method
    * Registers a zero-argument tool `name`, which will run the given function when the client calls it.
    */
    registerTool(name: string, callback: ToolCallback): void;

    /**
     * Registers a zero-argument tool `name` (with a description) which will run the given function when the client calls it.
     */
    registerTool(name: string, description: string, callback: ToolCallback): void;

    /**
     * Registers a tool `name` accepting the given arguments, which must be an object containing named properties associated with Zod schemas. When the client calls it, the function will be run with the parsed and validated arguments.
     */
    registerTool<Args extends ZodRawShape>(
        name: string,
        paramsSchema: Args,
        outputSchema: Args,
        callback: ToolCallback<Args>
    ): void;

    /**
     * Registers a tool `name` (with a description) accepting the given arguments, which must be an object containing named properties associated with Zod schemas. When the client calls it, the function will be run with the parsed and validated arguments.
     */
    registerTool<ParamArgs extends ZodRawShape, OutputSchema extends ZodRawShape>(
        name: string,
        description: string,
        paramsSchema: ParamArgs,
        responseSchema: OutputSchema,
        callback: ToolCallback<ParamArgs>
    ): void;

    registerTool<ParamArgs extends ZodRawShape, OutputSchema extends ZodRawShape>(
        name: string,
        description: string,
        paramsSchema: ParamArgs,
        responseSchema: OutputSchema,
        timeout: number,
        callback: ToolCallback<ParamArgs>
    ): void;

    registerTool(name: string, ...rest: unknown[]): void {
        if (this._registeredTools[name]) {
            throw new Error(`Tool: ${name} is already registered`);
        }

        let description: string | undefined;
        if (typeof rest[0] === "string") {
            description = rest.shift() as string;
        }

        let paramsSchema: ZodRawShape | undefined;
        if (rest.length > 1) {
            paramsSchema = rest.shift() as ZodRawShape;
        }

        let responseSchema: ZodRawShape | undefined;
        if (rest.length > 1) {
            responseSchema = rest.shift() as ZodRawShape;
        }

        // Default timeout duration is 10 seconds (10000[ms])
        let timeout: number = 10_000;
        if (rest.length > 1) {
            timeout = rest.shift() as number;
        }

        const callback = rest[0] as ToolCallback<ZodRawShape | undefined>;
        this._registeredTools[name] = {
            description,
            inputSchema: paramsSchema === undefined ?
                undefined : z.object(paramsSchema),
            responseSchema: responseSchema === undefined ?
                undefined : z.object(responseSchema),
            timeout,
            callback
        };
    }

    removeTool(name: string) {
        delete this._registeredTools[name];
    }

    private async runTool(
        tool: RegisteredTool,
        request: ToolInvocationRequest
    ): Promise<ToolInvocationResult> {
        if (tool.inputSchema) {
            const parseResult = await tool.inputSchema.safeParseAsync(
                request.arguments
            );

            if (!parseResult.success) {
                throw new MACError(
                    ErrorCode.InvalidParams,
                    `Invalid arguments provided for tool: ${request.name}: ${parseResult.error.message}`,
                );
            }

            const args = parseResult.data,
                callback = tool.callback as ToolCallback<ZodRawShape>;

            try {
                return await Promise.resolve(callback(args));
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: error instanceof Error ? error.message : String(error)
                        }
                    ],
                    isError: true
                };
            }
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Tool: ${request.name} does not specify an input schema.`
                }
            ],
            isError: true
        };
    }

    /**
     * Handles the tool request within the timeout limit (default 10 seconds ~ 10_000 [ms])
     */
    async handleToolRequest(request: ToolInvocationRequest): Promise<ToolInvocationResult> {
        const tool = this._registeredTools[request.name];

        if (!tool) {
            throw new MACError(
                ErrorCode.InvalidToolRequest,
                `Tool: ${request.name} does not exist.`
            );
        }

        // 10 seconds is the default timeout duration for all tool requests if one is not specified
        const timeoutDuration = tool.timeout ?? 10_000;
        let timeoutHandler: NodeJS.Timeout;

        const toolResult = await this.runTool(tool, request);
        const timeoutPromise: Promise<ToolInvocationResult> = new Promise((_, reject) => {
            timeoutHandler = setTimeout(() => {
                reject({
                    content: [
                        {
                            type: "text",
                            text: `Tool: ${request.name} did not finish within the allotted time limit: ${timeoutDuration} [ms]`
                        }
                    ],
                    isError: true
                });
            }, timeoutDuration);
        });

        return Promise.race([
            timeoutPromise,
            toolResult
        ]).then((res) => {
            clearTimeout(timeoutHandler);
            return res;
        });
    }

    // Utils
    private registeredToolsToString(): string[] {
        const toolDescriptions: string[] = [];

        Object.entries(this._registeredTools).forEach((entry) => {
            const name: string = entry[0],
                tool: RegisteredTool = entry[1],
                description: string | undefined = tool.description;

            const toolJSONDescription = JSON.stringify({
                name,
                description,
                parameterSchema: (tool.inputSchema ? zodToJsonSchema(tool.inputSchema) : "None"),
                responseSchema: (tool.responseSchema ? zodToJsonSchema(tool.responseSchema) : "None")
            });

            toolDescriptions.push(toolJSONDescription);
        });

        return toolDescriptions;
    }

    private actionLogsToString(): string[] {
        const logs: string[] = [];

        this._actionLogs.forEach((actionLog) => {
            logs.push(JSON.stringify(actionLog));
        });

        return logs;
    }

    /**
     * Used to clear action logs when new prompts are requested 
     */
    private clearActionLogs(): void {
        this._actionLogs = [];
    }
}

export default Orchestrator;