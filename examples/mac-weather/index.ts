import { z } from "zod";
import LLMBridge from "../../src/lib/bridge/llmbridge";
import {
    MacInput,
    MacOutput
} from "../../src/lib/shared/types";
import OpenAI from "openai";
import Mac from "../../src/lib/model-agnostic-context/mac";
import { PolicyBuilder } from "../../src/lib/policy-manager/policy";
import dotenv from "dotenv";

// Load env variables
dotenv.config();
const client = new OpenAI({ apiKey: process.env.OPEN_AI_API_KEY });

const GeoResultSchema = z.object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
})

const WeatherResultSchema = z.object({
    current_weather: z.object({
        time: z.string(),
        interval: z.number(),
        temperature: z.number(),
        windspeed: z.number(),
        winddirection: z.number(),
        is_day: z.union([z.literal(1), z.literal(0)]),
        weatherCode: z.number().default(0)
    })
});

type GeoResult = z.infer<typeof GeoResultSchema>;
type WeatherResult = z.infer<typeof WeatherResultSchema>;

function main() {
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

    const mac = new Mac(openAIBridge);
 
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

                return GeoResultSchema.parse(geoData[0]);
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
                structuredContent: {
                    current_weather: weather.current_weather
                }
            };
        }
    });

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

    mac.handlePrompt("What's the weather in NYC?");
}

main();