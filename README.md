# @kigathi/ai-agents

Unified Agents/Bots SDK for the OpenAI Responses API.

## Install

```bash
npm install @kigathi/ai-agents
```

For direct mode, also install:

```bash
npm install openai
```

## Quick API shape

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient(config);
sdk.registerTool(tool);
sdk.createAgent(agent);
const result = await sdk.run(params);
```

## Modes

The SDK supports three setup patterns, and in normal usage you do not need to pass `mode` manually. The client infers it from the config you provide.

### 1. Direct mode

Use this when your app should call OpenAI directly and you do not need backend persistence.

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
});
```

Required:

- `apiKey`

### 2. Proxy mode

Use this when your app should call your backend, and your backend should perform the agent run.

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  backendUrl: "https://api.example.com",
});
```

Required:

- `backendUrl`

### 3. Direct mode with backend persistence

Use this when your app should call OpenAI directly, but you still want your backend to persist messages, receive tool events, or trigger downstream workflows.

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
  backendUrl: "https://api.example.com",
});
```

Required:

- `apiKey`
- `backendUrl`

Behavior summary:

- `apiKey` only: direct OpenAI execution
- `backendUrl` only: proxy mode, where your backend performs the run
- `apiKey` and `backendUrl` together: direct OpenAI execution plus backend persistence and event sync

## Minimal vs full examples

The sections below show the smallest valid call for each API, followed by a more realistic production-style example.

### 1. Create a client

Minimal direct mode:

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
});
```

Minimal proxy mode:

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  backendUrl: "https://api.example.com",
});
```

Full example:

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
  orgId: process.env.OPENAI_ORG_ID,
  projectId: process.env.OPENAI_PROJECT_ID,
  backendUrl: "https://api.example.com",
  pricing: {
    "gpt-4.1-mini": {
      prompt_per_million: 0.4,
      completion_per_million: 1.6,
    },
  },
});
```

Required parameters:

- Direct mode: `apiKey`
- Proxy mode: `backendUrl`

Optional parameters:

- `mode`
- `orgId`
- `projectId`
- `pricing`

### Direct OpenAI + backend persistence mode

You can also run the model directly with OpenAI while still sending conversation events to your backend for persistence, analytics, or post-processing.

Use `apiKey` and `backendUrl` together:

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
  backendUrl: "https://api.example.com",
});
```

What this mode does:

- Runs the actual model request against OpenAI directly
- Persists user and assistant messages to your backend
- Syncs tool-call events to your backend on a best-effort basis

Useful request fields in this mode:

- `conversation_id`
- `user_id`
- `metadata`
- `client_message_id`
- `idempotency_key`
- `idempotency_key_response`

### 2. Register a tool

Minimal example:

```js
sdk.registerTool({
  name: "lookup_order",
});
```

Full example:

```js
sdk.registerTool({
  name: "lookup_order",
  type: "function",
  description: "Find order details by order number.",
  parameters_schema: {
    type: "object",
    properties: {
      order_number: { type: "string" },
    },
    required: ["order_number"],
  },
  handler: async ({ order_number }, context) => {
    return {
      order_number,
      status: "processing",
      requested_by: context.userId ?? null,
    };
  },
});
```

Required parameters:

- `name`

Useful optional parameters:

- `description`
- `parameters_schema`
- `handler`

Notes:

- If you omit `handler`, tool calls will fail gracefully with `Tool not registered: <name>`.
- If an agent does not list specific tools, it can use all registered tools.

### 3. Register an agent

Minimal example:

```js
sdk.createAgent({
  name: "support-bot",
  model: "gpt-4.1-mini",
});
```

Full example:

```js
sdk.createAgent({
  id: "support-bot-v1",
  name: "support-bot",
  model: "gpt-4.1-mini",
  instructions: "You are a concise support assistant. Use tools when needed.",
  temperature: 0.3,
  max_output_tokens: 400,
  tools: ["lookup_order"],
  metadata: {
    team: "support",
    channel: "web",
  },
});
```

Required parameters:

- `name`
- `model`

Useful optional parameters:

- `id`
- `instructions`
- `temperature`
- `max_output_tokens`
- `tools`
- `metadata`

### 4. Run an agent

Minimal example:

```js
const result = await sdk.run({
  agent: "support-bot",
  message: "Where is order AX-4420?",
});

console.log(result.output_text);
```

Full example:

```js
const result = await sdk.run({
  agent: "support-bot",
  message: "Check order AX-4420 and summarize the current status.",
  conversation_id: 1234,
  conversation_key: "support:customer-42",
  user_id: 42,
  context: {
    userId: 42,
    accountId: "acc_123",
  },
  messages: [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "How can I help?" },
  ],
  max_history_messages: 20,
  maxToolIterations: 8,
});

console.log(result.output_text);
console.log(result.usage);
console.log(result.cost_usd);
```

Required parameters:

- `agent`
- `message`

Useful optional parameters:

- `conversation_id`
- `conversation_key`
- `user_id`
- `context`
- `messages`
- `max_history_messages`
- `maxToolIterations`
- `previous_response_id`
- `replying_to`

### 5. Stream an agent response

Minimal example:

```js
for await (const delta of sdk.runStream({
  agent: "support-bot",
  message: "Give me a short update on order AX-4420.",
})) {
  process.stdout.write(delta);
}
```

Full example:

```js
for await (const delta of sdk.runStream({
  agent: "support-bot",
  message: "Summarize the latest ticket updates.",
  conversation_key: "support:customer-42",
  user_id: 42,
})) {
  process.stdout.write(delta);
}
```

## Complete minimal working example

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
});

sdk.registerTool({
  name: "lookup_order",
  description: "Return a fake order status.",
  parameters_schema: {
    type: "object",
    properties: {
      order_number: { type: "string" },
    },
    required: ["order_number"],
  },
  handler: async ({ order_number }) => ({
    order_number,
    status: "processing",
  }),
});

sdk.createAgent({
  name: "support-bot",
  model: "gpt-4.1-mini",
  instructions: "You are a concise support assistant.",
  tools: ["lookup_order"],
});

const result = await sdk.run({
  agent: "support-bot",
  message: "Check order AX-4420",
});

console.log(result.output_text);
```

## Complete proxy example

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  backendUrl: "https://api.example.com",
});

const result = await sdk.run({
  agent: "support-bot",
  message: "Start claim #99",
  conversation_id: 1234,
});

console.log(result.output_text);
```

## Complete direct + backend persistence example

```js
import { createClient } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
  backendUrl: "https://api.example.com",
});

sdk.registerTool({
  name: "lookup_order",
  description: "Find order by order number.",
  parameters_schema: {
    type: "object",
    properties: {
      order_number: { type: "string" },
    },
    required: ["order_number"],
  },
  handler: async ({ order_number }) => ({
    order_number,
    status: "processing",
  }),
});

sdk.createAgent({
  name: "support-bot",
  model: "gpt-4.1-mini",
  instructions: "You are a concise support assistant.",
  tools: ["lookup_order"],
});

const result = await sdk.run({
  agent: "support-bot",
  message: "Check order AX-4420",
  conversation_id: 1234,
  user_id: 42,
  client_message_id: "msg_123",
  metadata: {
    source: "dashboard",
    account_id: "acc_123",
  },
});

console.log(result.output_text);
```

## Full sample apps

- [express-chat](https://github.com/kigathi-chege/lyre-ai-agents-examples/tree/main/express-chat) - Express server + Tailwind widget UI
- [nuxt-chat](https://github.com/kigathi-chege/lyre-ai-agents-examples/tree/main/nuxt-chat) - Nuxt 3 app + server API route + Tailwind
- [sveltekit-chat](https://github.com/kigathi-chege/lyre-ai-agents-examples/tree/main/sveltekit-chat) - SvelteKit app + server endpoint + Tailwind

All three use `@kigathi/ai-agents` in direct mode with backend persistence so OpenAI handles model execution while Axis stores conversation, message, and related event metadata.

## Notes

- `createClient()` auto-selects proxy mode when `backendUrl` is provided without `apiKey`. Otherwise it uses direct mode.
- In direct mode, the consuming app must have the `openai` package installed.
- In direct mode with `backendUrl`, the SDK still calls OpenAI directly, then asynchronously persists messages and tool events to your backend.
- You can pass either an agent name/id or a full agent object to `run()`.
- If proxy mode cannot find a local agent, it will try to resolve the agent from the backend.
