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

    mac.addResource({
        name: "USGS Earthquake Feed (24h)",
        uri: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
        metadata: {
            provider: "USGS",
            dataType: "earthquake-events",
            source: "https://earthquake.usgs.gov/",
            updated: new Date().toISOString()
        },
        callback: async () => {
            const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
                res = await fetch(url);

            if (!res.ok) {
                return {
                    content: [{
                        uri: url,
                        text: "Unable to fetch earthquake data at this time.",
                        mimeType: "text"
                    }]
                };
            }

            // Context window is limited so it's necessary to cut the data down here as much as possible
            const data = await res.json(),
                top5 = data.features.slice(0, 5).map((quake: any, idx: number) => {
                    const { place, mag, time } = quake.properties;
                    const quakeTime = new Date(time).toLocaleString();
                    return `${idx + 1}. Magnitude ${mag} - ${place} at ${quakeTime}`;
                });

            return {
                content: [{
                    uri: url,
                    text: `🌍 Top 5 US Earthquakes in the Last 24 Hours:\n\n${top5.join("\n")}`,
                    mimeType: "text"
                }]
            };
        }
    });

    const calmTonePolicy = new PolicyBuilder()
        .setName("Calm Tone in Natural Disaster Reports")
        .setDescription("The assistant should avoid language that may incite panic when discussing earthquake events.")
        .setTags(["earthquake", "tone", "risk-communication"])
        .setRule(`
        When reporting on earthquakes or other natural disasters, maintain a calm, neutral tone. 
        Do not use alarmist language such as "catastrophic", "devastating", or "apocalyptic" unless officially declared by a government agency.`)
        .build();

    mac.addPolicies([calmTonePolicy]);
    mac.setActivePoliciesWithNames([calmTonePolicy.name]);

    mac.handlePrompt("What's were the top 5 earthquakes in the last 24 hours?");
}

main();