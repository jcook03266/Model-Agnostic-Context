# Model Agnostic Context Protocol

## Overview
The **Model Agnostic Context Protocol** (MACP) provides a standardized way for language models to retrieve information and execute deterministic logic via a server, enabling structured and agentic task execution. Unlike existing solutions such as Anthropic's Model Context Protocol (MCP), this protocol is **fully open-source and model-agnostic**, allowing integration with any LLM that can handle structured responses.

## Why MACP?
Existing solutions, like MCP, are tied to specific platforms and lack full transparency. MACP aims to:
- **Ensure interoperability** across different LLM providers.
- **Maintain security** by adhering to CIA (Confidentiality, Integrity, Availability) principles.
- **Guarantee type safety** in interactions between models and tools.
- **Provide deterministic behavior** when executing model-assisted tasks.

## How It Works
1. A user submits a prompt from a client.
2. The prompt is sent to a server where it is combined with:
   - Server-side context (agent role, guidelines, etc.).
   - Available tool context.
   - Schema information.
   - Response structuring details.
3. The enriched prompt is sent to the LLM.
4. The LLM determines if the request can be fulfilled:
   - If **not possible**, a fallback response is generated.
   - If **possible**, the LLM returns a structured JSON containing tool calls and parameters.
5. The JSON is parsed and **validated using Zod** for type safety.
6. If errors occur at any stage:
   - The LLM is reprompted to fix the error.
   - If retries fail, a fallback response is returned.
7. If all checks pass, the tools execute their functions.
8. A structured response is sent to the client with the final result.

## Features
- **Model-Agnostic** – Works with any LLM that supports structured responses.
- **Type-Safe** – Uses **Zod** for runtime validation.
- **Fallback Handling** – Ensures a graceful response when errors occur.
- **Deterministic Execution** – Ensures tool calls are executed correctly.
- **Extensible & Modular** – Easily integrate new tools and transformations.

