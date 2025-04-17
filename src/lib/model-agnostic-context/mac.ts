import { ZodRawShape } from "zod";
import LLMBridge from "../bridge/llmbridge";
import Orchestrator from "../orchestrator/orchestrator";
import { ErrorCode, MACError, ToolCallback } from "../shared/types";
import { Policy } from "../policy-manager/policy";

/**
 * High level interface for interacting with the model-agnostic-context library.
 * ## Quick setup:
 * 1. Specify an LLM to use to execute prompts (e.g. ChatGPT, Claude, DeepSeek etc)
 * 2. Add tools for the LLM to use; you can specify individual execution time limits for these as well.
 * 3. Add some policies you want your agent to adhere to
 * 4. Activate your custom policies
 * 5. Specify your completion handler which will receive the final result.
 * 6. Enter a prompt for your agent to answer
 */
export default class Mac {
    // Properties
    private orchestrator: Orchestrator = Orchestrator.instance;

    constructor(bridge: LLMBridge) {
        this.orchestrator.registerBridge(bridge);
        this.orchestrator.currentBridge = bridge.name;
    }

    // Tools
    public addTool<ParamArgs extends ZodRawShape, OutputSchema extends ZodRawShape>(
        tool: {
            name: string,
            description: string,
            paramsSchema: ParamArgs,
            responseSchema: OutputSchema,
            callback: ToolCallback<ParamArgs>
        }) {
        this.orchestrator
            .registerTool(
                tool.name,
                tool.description,
                tool.paramsSchema,
                tool.responseSchema,
                tool.callback
            );
    }

    public addTools<ParamArgs extends ZodRawShape, OutputSchema extends ZodRawShape>(
        tools: {
            name: string,
            description: string,
            paramsSchema: ParamArgs,
            responseSchema: OutputSchema,
            callback: ToolCallback<ParamArgs>
        }[]) {
        tools.forEach((tool) => {
            this.addTool(tool);
        });
    }

    public removeTool(name: string) {
        this.orchestrator.removeTool(name);
    }

    // Policy Management
    addPolicy(p: Policy) {
        this.orchestrator.policyManager.addPolicy(p);
    }

    addPolicies(policies: Policy[]) {
        this.orchestrator.policyManager.addPolicies(policies);
    }

    activatePolicy(name: string) {
        this.orchestrator.policyManager.activatePolicy(name);
    }

    setActivePoliciesWithNames(names: string[]) {
        this.orchestrator.policyManager.setActivePoliciesWithNames(names);
    }

    setActivePoliciesWithTags(tags: string[]) {
        this.orchestrator.policyManager.setActivePoliciesWithTags(tags);
    }

    deactivatePolicy(name: string) {
        this.orchestrator.policyManager.deactivatePolicy(name);
    }

    deactivatePoliciesWithNames(names: string[]) {
        this.orchestrator.policyManager.deactivatePoliciesWithNames(names);
    }

    deactivatePoliciesWithTags(tags: string[]) {
        this.orchestrator.policyManager.deactivatePoliciesWithTags(tags);
    }

    // Bridge Management
    public addBridge(bridge: LLMBridge) {
        this.orchestrator.registerBridge(bridge);
    }

    public removeBridge(name: string) {
        this.orchestrator.removeBridge(name);
    }

    public useBridge(name: string) {
        this.orchestrator.currentBridge = name;
    }

    // Prompt context injection logic 
    public async handlePrompt(prompt: string) {
        // Make sure there's an active LLM bridge to use 
        if (!this.orchestrator.currentBridge) {
            throw new MACError(
                ErrorCode.BridgeMissing,
                `Can't process prompt, no registered bridge has been selected.`
            );
        }

        await this.orchestrator.executePrompt(
            this.orchestrator.currentBridge,
            prompt
        );
    }
}