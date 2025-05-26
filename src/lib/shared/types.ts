import { AnyZodObject, z, ZodRawShape, ZodTypeAny } from "zod";
import { UriTemplate, Variables } from "./uriTemplate";

// Errors
export enum ErrorCode {
    PolicyViolation = 100,
    InvalidRequest = 101,
    InvalidParams = 102,
    InternalError = 103,
    InsufficientTooling = 104,
    Timeout = 105,
    InvalidToolRequest = 106,
    InvalidToolResponse = 107,
    InvalidResourceRequest = 108,
    InvalidResourceResponse = 109,
    InvalidResponse = 110,
    BridgeMissing = 111,
    MaxActionChainLengthExceeded = 112
}

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

// Requests
export enum RequestTypes {
    ToolRequest = "Tool-Request",
    ResourceRequest = "Resource-Request"
}

// Resources
/**
 * URI resolvable data to inject as context  
 * Resources are how you expose data to LLMs. They're similar to GET endpoints in a REST API 
 * - they provide data but shouldn't perform significant computation or have side effects
 */
export const ResourceSchema = z.object({
    /**
     * Name / identifier of the resource
     */
    name: z.string(),
    uri: z.string(),
    /**
     * Human-readable description of the tool and its purpose/functionality
     */
    description: z.optional(z.string()),
    /**
     * Optional MIME-type for specifying the type of data being returned by the resource call
     */
    mimeType: z.optional(z.string())
})
    .passthrough();

/**
 * A template description for resources available on the server.
 */
export const ResourceTemplateSchema = z
    .object({
        /**
         * A URI template (according to RFC 6570) that can be used to construct resource URIs.
         */
        uriTemplate: z.string(),

        /**
         * A human-readable name for the type of resource this template refers to.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.string(),

        /**
         * A description of what this template is for.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.optional(z.string()),

        /**
         * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
         */
        mimeType: z.optional(z.string()),
    })
    .passthrough();

/**
 * The contents of a specific resource or sub-resource.
 */
export const ResourceContentsSchema = z
    .object({
        /**
         * The URI of this resource.
         */
        uri: z.string(),
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.optional(z.string()),
    })
    .passthrough();

export const TextResourceContentsSchema = ResourceContentsSchema.extend({
    /**
     * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
     */
    text: z.string(),
});

export const BlobResourceContentsSchema = ResourceContentsSchema.extend({
    /**
     * A base64-encoded string representing the binary data of the item.
     */
    blob: z.string().base64(),
});

/**
 * Sent from the client to the server, to read a specific resource URI.
 */
export const ReadResourceRequestSchema = z.object({
    type: z.literal(RequestTypes.ResourceRequest),
    uri: z.string()
});

/**
 * The server's response to a resources/read request from the client.
 */
export const ReadResourceResultSchema = z.object({
    content: z.array(
        z.union([TextResourceContentsSchema, BlobResourceContentsSchema]),
    )
});

/**
 * Additional, optional information for annotating a resource.
 */
export type ResourceMetadata = Omit<Resource, "uri" | "name">;

/**
 * Callback to read a resource at a given URI.
 */
export type ReadResourceCallback = (
    uri: URL,
) => ReadResourceResult | Promise<ReadResourceResult>;

export type RegisteredResource = {
    name: string;
    metadata?: ResourceMetadata;
    callback: ReadResourceCallback;
    enabled: boolean;
    enable(): void;
    disable(): void;
    update(updates: { name?: string, uri?: string | null, metadata?: ResourceMetadata, callback?: ReadResourceCallback, enabled?: boolean }): void
    remove(): void
};

export type RegisteredResourceTemplate = {
    resourceTemplate: ResourceTemplate;
    metadata?: ResourceMetadata;
    callback: ReadResourceTemplateCallback;
    enabled: boolean;
    enable(): void;
    disable(): void;
    update(updates: { name?: string | null, template?: ResourceTemplate, metadata?: ResourceMetadata, callback?: ReadResourceTemplateCallback, enabled?: boolean }): void
    remove(): void
};

/**
 * Callback to read a resource at a given URI, following a filled-in URI template.
 */
export type ReadResourceTemplateCallback = (
    uri: URL,
    variables: Variables
) => ReadResourceResult | Promise<ReadResourceResult>;

/**
 * A callback to complete one variable within a resource template's URI template.
 */
export type CompleteResourceTemplateCallback = (
    value: string,
) => string[] | Promise<string[]>;

/**
 * A resource template combines a URI pattern with optional functionality to enumerate
 * all resources matching that pattern.
 */
export class ResourceTemplate {
    private _uriTemplate: UriTemplate;

    constructor(
        uriTemplate: string | UriTemplate,
        private _callbacks: {
            /**
             * An optional callback to autocomplete variables within the URI template. Useful for clients and users to discover possible values.
             */
            complete?: {
                [variable: string]: CompleteResourceTemplateCallback;
            };
        },
    ) {
        this._uriTemplate =
            typeof uriTemplate === "string"
                ? new UriTemplate(uriTemplate)
                : uriTemplate;
    }

    /**
     * Gets the URI template pattern.
     */
    get uriTemplate(): UriTemplate {
        return this._uriTemplate;
    }

    /**
     * Gets the callback for completing a specific URI template variable, if one was provided.
     */
    completeCallback(
        variable: string,
    ): CompleteResourceTemplateCallback | undefined {
        return this._callbacks.complete?.[variable];
    }
}

// Tools
/**
 * Tools are dynamic resources executable by the LLM. Tools provide dynamic data using input
 * parameters chosen by the LLM. Tools are intended to have side effects.
 */
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
    }).passthrough(), // Allows object schema to preserve properties that are not explicitly defined within the schema itself
    /**
     * The time in milliseconds [ms] that this tool is allowed to run for. If the tool doesn't 
     * return a result within the specified time period then a timeout error is thrown.
     * 
     * Default timeout is 10 seconds ~ 10_000 milliseconds 
     */
    timeout: z.number()
})
    .passthrough();

/**
 * Request by the LLM to invoke a tool
 */
export const ToolRequestSchema = z.object({
    type: z.literal(RequestTypes.ToolRequest),
    name: z.string(),
    // Validated with tool specific schema
    arguments: z.record(z.unknown())
});

/**
 * Response to an executed tool request by the LLM
 */
export const ToolResultSchema = z.object({
    /**
     * An object containing structured tool output.
     *
     * If the Tool defines an responseSchema, this field MUST be present in the result, and contain a JSON object that matches the schema.
     */
    structuredContent: z.object({}).passthrough().optional(),
    /** 
     * True if an error has occurred during the tool's execution, false otherwise
     */
    isError: z.boolean().default(false).optional()
});

export type ToolCallback<ParamArgs extends undefined | ZodRawShape = undefined> =
    ParamArgs extends ZodRawShape
    ? (
        args: z.objectOutputType<ParamArgs, ZodTypeAny>
    ) => ToolResult | Promise<ToolResult>
    : () => ToolResult | Promise<ToolResult>;

export type RegisteredTool = {
    description?: string;
    inputSchema?: AnyZodObject;
    responseSchema?: AnyZodObject;
    callback: ToolCallback<undefined | ZodRawShape>;
    timeout?: number;
    enabled: boolean;
    enable(): void;
    disable(): void;
    update<InputArgs extends ZodRawShape, OutputArgs extends ZodRawShape>(
        updates: {
            name?: string | null,
            description?: string,
            paramsSchema?: InputArgs,
            outputSchema?: OutputArgs,
            callback?: ToolCallback<InputArgs>,
            enabled?: boolean,
            timeout?: number;
        }): void
    remove(): void
};

// LLM 
/**
 * Describes a message returned as part of a prompt.
 */
export const LLMMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.union([
        TextContentSchema,
        ImageContentSchema,
        AudioContentSchema
    ])
});

export const MacInputSchema = z.object({
    input: z.string()
});

export const MacOutputSchema = z.object({
    embeddedContentResponse: z.string().nullable().optional(),
    content: z.union([
        TextContentSchema,
        ImageContentSchema,
        AudioContentSchema
    ]).nullable().optional(),
    error: z.string().nullable().optional()
}).passthrough();

export const LLMGeneratedErrorSchema = z.object({
    errorMessage: z.string(),
    errorCode: z.number()
});

export const MacDiscoveryOutputSchema = z.object({
    resourceRequest: ReadResourceRequestSchema.nullable().optional(),
    toolRequest: ToolRequestSchema.nullable().optional(),
    error: LLMGeneratedErrorSchema.nullable().optional()
});

const PromptSchema = z.object({
    task: z.string(),
    checklist: z.array(z.string()),
    maxSequentialActions: z.number(),
    systemPolicies: z.array(z.string()),
    userPolicies: z.array(z.string()),
    resources: z.array(z.string()),
    resourceTemplates: z.array(z.string()),
    tools: z.array(z.string()),
    responseSchema: z.any(),
    errorCodes: z.any(),
    promptToAnswer: z.string()
});

const DiscoveryPromptSchema = PromptSchema.extend({});

/**
 * Include context-enriched output content and any subsequent tool requests
 */
export const LLMContextAwareOutputSchema = MacOutputSchema.extend({
    toolInvocationRequest: ToolRequestSchema.nullable().optional()
});

const ContextAwarePromptSchema = PromptSchema.extend({
    actionsTaken: z.array(z.string())
});

const actionLogSchema = z.object({
    type: z.nativeEnum(RequestTypes),
    name: z.string().optional(),
    arguments: z.record(z.unknown()).optional(),
    timeExecuted: z.number(),
    response: z.object({}).passthrough().optional(),
    isError: z.boolean().default(false).optional()
});

// Results
/**
 * Response to a tools/list request function invocation
 */
export const ListToolsResultSchema = z.object({
    tools: z.array(ToolSchema)
});

// Errors
/**
 * Used to emit verbose error messages
 */
export class MACError extends Error {
    constructor(
        public readonly code: number,
        message: string,
        public readonly data?: unknown
    ) {
        super(`MAC error ${code}: ${message}`);
        this.name = "MACError";
    }
}

type Primitive = string | number | boolean | bigint | null | undefined;
type Flatten<T> = T extends Primitive
    ? T
    : T extends Array<infer U>
    ? Array<Flatten<U>>
    : T extends Set<infer U>
    ? Set<Flatten<U>>
    : T extends Map<infer K, infer V>
    ? Map<Flatten<K>, Flatten<V>>
    : T extends object
    ? { [K in keyof T]: Flatten<T[K]> }
    : T;

export type Infer<Schema extends ZodTypeAny> = Flatten<z.infer<Schema>>;

/** LLM I/O / Prompts */
export type LLMMessage = Infer<typeof LLMMessageSchema>;
export type MacInput = Infer<typeof MacInputSchema>;
export type MacOutput = Infer<typeof MacOutputSchema>;
export type DiscoveryPrompt = Infer<typeof DiscoveryPromptSchema>;
export type ContextAwarePrompt = Infer<typeof ContextAwarePromptSchema>;

/** Resources */
export type ResourceContents = Infer<typeof ResourceContentsSchema>;
export type TextResourceContents = Infer<typeof TextResourceContentsSchema>;
export type BlobResourceContents = Infer<typeof BlobResourceContentsSchema>;
export type Resource = Infer<typeof ResourceSchema>;
export type ReadResourceRequest = Infer<typeof ReadResourceRequestSchema>;
export type ReadResourceResult = Infer<typeof ReadResourceResultSchema>;

/** Tools */
export type Tool = Infer<typeof ToolSchema>;
export type ToolRequest = Infer<typeof ToolRequestSchema>;
export type ToolResult = Infer<typeof ToolResultSchema>;

/** Content */
export type TextContent = Infer<typeof TextContentSchema>;
export type ImageContent = Infer<typeof ImageContentSchema>;
export type AudioContent = Infer<typeof AudioContentSchema>;

/** Actions */
export type ActionLog = Infer<typeof actionLogSchema>;
