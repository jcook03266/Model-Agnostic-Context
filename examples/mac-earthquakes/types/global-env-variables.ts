// Declaring env variables in the global name space to make accessing them easier
declare global {
    namespace NodeJS {
        type ProcessEnvType = keyof ProcessEnv;
        interface ProcessEnv {
            // Environment Flag
            NODE_ENV: "development" | "production" | "test";
            OPEN_AI_API_KEY: string;
        }
    }
}

export { };
