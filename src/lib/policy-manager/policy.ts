import { PolicyI, PolicyBuilderI } from "../shared/interfaces";

export class Policy implements PolicyI {
    readonly name: string = "";
    readonly description: string = "";
    readonly rule: string = "";
    readonly tags: string[] = [];

    constructor({
        name,
        description,
        rule,
        tags
    }: PolicyI) {
        this.name = name;
        this.description = description;
        this.rule = rule;
        this.tags = tags;
    }

    toString(): string {
        return (`
            Policy: ${this.name}
            Description: ${this.description}
            Rule: ${this.rule}
            Tags: ${this.tags.join(",")}
        `);
    }
}

export class PolicyBuilder implements PolicyBuilderI {
    private name: string = "";
    private description: string = "";
    private rule: string = "";
    private tags: string[] = [];

    setName(name: string): PolicyBuilder {
        this.name = name;
        return this;
    }

    setDescription(description: string): PolicyBuilder {
        this.description = description;
        return this;
    }

    setRule(rule: string): PolicyBuilder {
        this.rule = rule;
        return this;
    }

    setTags(tags: string[]): PolicyBuilder {
        this.tags = tags;
        return this;
    }

    build(): Policy {
        return new Policy({
            name: this.name,
            description: this.description,
            rule: this.rule,
            tags: this.tags
        });
    }
}