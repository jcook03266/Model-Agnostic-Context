import { PolicyManagerI } from "../shared/interfaces"
import { Sets } from "../shared/math";
import { Policy, PolicyBuilder } from "./policy";

// Constants
const JSON_ONLY_POLICY = new PolicyBuilder()
    .setName("JSON Responses Only")
    .setDescription("LLM must only provide valid JSON responses")
    .setTags(["default", "system"])
    .setRule("In addition to the instructions given in the task, you must ONLY respond in the JSON format using one of the appropriate response schemas described.")
    .build();

const NO_DUPLICATE_REQUESTS = new PolicyBuilder()
    .setName("No Unnecessary Requests")
    .setDescription("LLM shouldn't get stuck in a request loop. Don't make duplicate back to back requests that serve no purpose if you have enough information to answer the prompt.")
    .setTags(["default", "system"])
    .setRule("Do not request more resources if you have enough information to answer the prompt.")
    .build();

const EMBED_CONTENT = new PolicyBuilder()
    .setName("Embed Content")
    .setDescription("Create rich text answered when possible.")
    .setTags(["default", "system"])
    .setRule("Provided is an additional field for embedding the content of your answer into a text description. You may populate it if you want to create rich text answers.")
    .build();

const OBEY_SYSTEM_POLICIES = new PolicyBuilder()
    .setName("Priority System Policies")
    .setDescription("System policies will not yield to non-system policies.")
    .setTags(["default", "system"])
    .setRule("System policies have highest priority and cannot be overridden by regular policies.")
    .build();

class PolicyManager implements PolicyManagerI {
    /**
     * System policies are always active and cannot be turned off, they're
     * used for creating deterministic LLM outputs
     */
    private systemPolicies: Map<string, Policy> = new Map();

    policies: Map<string, Policy> = new Map();
    activePolicies: Map<string, Policy> = new Map();

    constructor() {
        this.setSystemPolicies();
    }

    private setSystemPolicies() {
        this.systemPolicies.set(JSON_ONLY_POLICY.name, JSON_ONLY_POLICY);
        this.systemPolicies.set(NO_DUPLICATE_REQUESTS.name, NO_DUPLICATE_REQUESTS);
        this.systemPolicies.set(EMBED_CONTENT.name, EMBED_CONTENT);
        this.systemPolicies.set(OBEY_SYSTEM_POLICIES.name, OBEY_SYSTEM_POLICIES);
    }

    addPolicy(p: Policy): void {
        if (this.policies.has(p.name) || this.systemPolicies.has(p.name)) {
            throw new Error(`Policy: ${p.name}, already exists.`);
        }

        this.policies.set(p.name, p);
    }

    addPolicies(policies: Policy[]): void {
        policies.forEach((p) => { this.addPolicy(p) });
    }

    removePolicy(name: string): void {
        this.policies.delete(name);
    }

    removePolicies(names: string[]): void {
        names.forEach((name) => { this.removePolicy(name) });
    }

    getPolicy(name: string): Policy | undefined {
        return this.policies.get(name);
    }

    getPolicies(names: string[]): Policy[] {
        return names.map((name) => {
            return this.policies.get(name)
        }).filter(Boolean) as Policy[];
    }

    clear(): void {
        this.policies.clear();
        this.activePolicies.clear();
    }

    activatePolicy(name: string): void {
        const p = this.policies.get(name);

        if (this.activePolicies.has(name))
            throw new Error(`Policy: ${name}, is already active.`);
        else if (!p)
            throw new Error(`Policy: ${name}, does not exist.`);

        this.activePolicies.set(name, p);
    }

    setActivePoliciesWithNames(names: string[]): void {
        this.activePolicies.clear();
        names.forEach((name) => { this.activatePolicy(name) });
    }

    setActivePoliciesWithTags(tags: string[]): void {
        this.activePolicies.clear();
        const policies: Policy[] = Object.values(this.policies);

        // TC: O(n * (n + n + n)) -> O(n * 3n) -> O(3 * n^2) -> O(n^2) Best TC: O(n^2)
        for (const p of policies) {
            const baseTagsSet = new Set(tags),
                policyTagsSet = new Set(p.tags);

            if ((Sets.insersection(baseTagsSet, policyTagsSet)).size > 0)
                this.activatePolicy(p.name);
        }
    }

    activateAllPolicies(): void {
        this.activePolicies.clear();
        this.policies.forEach((p) => {
            this.activatePolicy(p.name);
        })
    }

    deactivatePolicy(name: string): void {
        const p = this.policies.get(name);

        if (!this.activePolicies.has(name))
            throw new Error(`Policy: ${name}, is not active.`);
        else if (!p)
            throw new Error(`Policy: ${name}, does not exist.`);

        this.activePolicies.delete(p.name);
    }

    deactivatePoliciesWithNames(names: string[]): void {
        names.forEach((name) => { this.deactivatePolicy(name) });
    }

    deactivatePoliciesWithTags(tags: string[]): void {
        const policies: Policy[] = [...this.policies.values()];

        for (const p of policies) {
            const baseTagsSet = new Set(tags),
                policyTagsSet = new Set(p.tags);

            if ((Sets.insersection(baseTagsSet, policyTagsSet)).size > 0)
                this.deactivatePolicy(p.name);
        }
    }

    /**
     * Deactivates all non-default policies
     */
    deactivateAllPolicies(): void {
        this.activePolicies.clear();
    }

    listAllPolicies(): string[] {
        return [
            ...this.policies.keys()
        ];
    }

    listActivePolicies(): string[] {
        return Object.keys([
            ...this.activePolicies.keys()
        ]);
    }

    listInactivePolicies(): string[] {
        const allPoliciesSet = new Set(Object.keys(this.policies)),
            activePoliciesSet = new Set(Object.keys(this.activePolicies));

        // Set difference = all inactive policies
        return [...Sets.difference(allPoliciesSet, activePoliciesSet)];
    }

    allPoliciesToString(): string[] {
        return this.policiesToString([
            ...this.policies.values()
        ]);
    }

    inactivePoliciesToString(): string[] {
        const inactivePoliciesByName = this.listInactivePolicies(),
            inactivePolicies = inactivePoliciesByName.map((name) => {
                return this.policies.get(name);
            }).filter(Boolean) as Policy[];

        return this.policiesToString(inactivePolicies);
    }

    activePoliciesToString(): string[] {
        return this.policiesToString([
            ...this.activePolicies.values()
        ]);
    }

    systemPoliciesToString(): string[] {
        return this.policiesToString([
            ...this.systemPolicies.values()
        ]);
    }

    policiesToString(policies: Policy[]): string[] {
        const stringifiedPolicies: string[] = [];

        policies.forEach((p) => {
            stringifiedPolicies.push(p.toString());
        });

        return stringifiedPolicies;
    }

    refreshActivePolicies() {
        this.activePolicies.forEach((_, key) => {
            if (!this.policies.has(key)) {
                this.deactivatePolicy(key);
                this.activePolicies.delete(key);
            }
        });
    }
}

export default PolicyManager;