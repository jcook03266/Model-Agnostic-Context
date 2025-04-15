import { MacInput, MacOutput } from "./types";

export interface LLMBridgeInterface {
    // Properties
    name: string
    promptExecutor: (input: MacInput) => Promise<MacOutput>;
    completionHandler: (output: MacOutput) => void;
}

export interface PolicyI {
    readonly name: string;
    readonly description: string;
    readonly rule: string;
    readonly tags: string[];

    toString(): string;
}

export interface PolicyBuilderI {
    // Private
    // name: string;
    // description: string;
    // rule: string;
    // tags: string[];

    setName(name: string): PolicyBuilderI;
    setDescription(description: string): PolicyBuilderI;
    setRule(rule: string): PolicyBuilderI;
    setTags(tags: string[]): PolicyBuilderI;
    build(): PolicyI;
}

export interface PolicyManagerI {
    policies: Map<string, PolicyI>;
    activePolicies: Map<string, PolicyI>;

    addPolicy(p: PolicyI): void;
    addPolicies(policies: PolicyI[]): void;

    removePolicy(name: string): void;
    removePolicies(names: string[]): void;

    getPolicy(name: string): PolicyI | undefined;
    getPolicies(names: string[]): PolicyI[];
    clear(): void;

    activatePolicy(name: string): void;
    setActivePoliciesWithNames(names: string[]): void;
    setActivePoliciesWithTags(tags: string[]): void;
    activateAllPolicies(): void;

    deactivatePolicy(name: string): void;
    deactivatePoliciesWithNames(names: string[]): void;
    deactivatePoliciesWithTags(tags: string[]): void;
    deactivateAllPolicies(): void;

    listAllPolicies(): string[];
    listActivePolicies(): string[];
    listInactivePolicies(): string[];

    allPoliciesToString(): string[];
    inactivePoliciesToString(): string[];
    activePoliciesToString(): string[];

    policiesToString(policies: PolicyI[]): string[];

    /**
     * Deactivates and removes disjoint active policies (active policies that are not
     * present in the base policies map, but are supposed to be)
     */
    refreshActivePolicies(): void;
}