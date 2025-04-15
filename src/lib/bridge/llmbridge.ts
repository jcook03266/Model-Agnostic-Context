import { LLMBridgeInterface } from "../shared/interfaces";
import { LLMMessage, MacInput, MacOutput } from "../shared/types";

class LLMBridge implements LLMBridgeInterface {
    // Properties
    name: string;

    // Handlers
    promptExecutor: (input: MacInput) => Promise<MacOutput>;
    completionHandler: (output: MacOutput) => void;

    constructor({
        name,
        promptExecutor,
        completionHandler
    }: {
        name: string,
        promptExecutor: (input: MacInput) => Promise<LLMMessage>,
        completionHandler: (output: MacOutput) => void
    }) {
        this.name = name;
        this.promptExecutor = promptExecutor;
        this.completionHandler = completionHandler;
    }
}

export default LLMBridge;