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
const speech = await sdk.tts.speak({ text: "Hello world" });
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
- `maxRetries`
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

### 6. Text to speech for read-aloud

OpenAI-backed examples first (minimal to advanced), then browser-native examples.

Mode quick guide:
- `data`: pass one precomputed payload (`audio_base64`, `mime_type`, `words`). Best when you already have full audio ready.
- `dataSource`: provide a function that returns one timed payload per chunk request. Best for progressive/background chunk loading.
- `endpoint`: built-in HTTP mode where `attachReadAloud` calls your API route per request/chunk.

#### OpenAI: `data` (minimal, direct SDK)

```js
import { createClient, attachReadAloud, extractReadAloudText } from "@kigathi/ai-agents";

const sdk = createClient({ apiKey: process.env.OPENAI_API_KEY });
const text = extractReadAloudText("#blog-content");
const speech = await sdk.tts.speak({ text });

attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  data: speech,
});
```

#### OpenAI: `data` (minimal, via API)

```js
const speech = await fetch("/api/read-aloud", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Read me aloud." }),
}).then((response) => response.json());

attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  data: speech,
});
```

#### OpenAI: `dataSource` (minimal, direct SDK)

```js
import { createClient, attachReadAloud } from "@kigathi/ai-agents";

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 0, // avoids hidden client-level retry duplication in demos
});

attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  dataSource: async ({ text }) => {
    return await sdk.tts.speak({ text });
  },
});
```

#### OpenAI: `dataSource` (minimal, via API)

```js
attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  dataSource: async ({ text, chunk_index, total_chunks, instructions }) => {
    const response = await fetch("/api/read-aloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, chunk_index, total_chunks, instructions }),
    });
    if (!response.ok) throw new Error(`Chunk request failed: ${response.status}`);
    return response.json();
  },
});
```

#### OpenAI: `endpoint` (minimal)

```js
attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  endpoint: "/api/read-aloud",
});
```

If you want to disable timed auto-scroll, pass `autoScroll: false`.

#### OpenAI: fully descriptive examples

`sdk.tts.speak(...)` is server-only because it requires an API key.

```js
const speech = await sdk.tts.speak({
  text: "This is a quick read-aloud example.",
  instructions: "Read in a confident, professional tone.",
  model: "gpt-4o-mini-tts",
  voice: "alloy",
  format: "mp3",
  chunking: "auto",
  maxChunkChars: 1600,
  maxTotalChars: 120000,
  includeWordTimings: true,
});
```

```js
attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  endpoint: "/api/read-aloud",
  instructions: "Custom narration instructions...",
  highlight: {
    mode: "css",
    color: "#fde68a",
    textColor: "inherit",
    radius: "0.6em",
    padding: "0.04em 0.24em",
  },
  progressive: {
    enabled: true,
    maxChunkChars: 1600,
    prefetchAhead: 1,
    retryCount: 0,
    retryDelayMs: 700,
  },
  autoScroll: {
    enabled: true,
    behavior: "smooth",
    block: "center",
    marginRatio: 0.24,
    throttleMs: 96,
  },
});
```

For this repo's SvelteKit demo, direct `dataSource` is wired in `articles/[slug]/+page.svelte` using `PUBLIC_OPENAI_API_KEY` (demo-only).
Warning: browser key mode exposes your key in client traffic/devtools and must not be used in production.

Retry note:
- If you see repeated identical calls to `/v1/audio/speech`, check retry layers.
- OpenAI client retries can be controlled with `createClient({ maxRetries })`.
- `attachReadAloud` progressive retries are explicit (`progressive.retryCount`) and can be traced with `debugHook`.

Default minimal profile:
- `maxChunkChars: 1600` (global default)
- `maxRetries: 0` (global client default)
- `progressive.retryCount: 0` (global read-aloud default)

Override defaults (production resilience):

```js
const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 2,
});

attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  endpoint: "/api/read-aloud",
  progressive: {
    maxChunkChars: 2200,
    retryCount: 2,
  },
});
```

```js
attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  endpoint: "/api/read-aloud",
  debugHook: (event) => console.debug("read-aloud", event),
});
```

#### Browser API: minimal

```js
attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
});
```

#### Browser API: fully descriptive options

```js
import { attachReadAloud, READ_ALOUD_DEFAULTS } from "@kigathi/ai-agents/browser";

console.log(READ_ALOUD_DEFAULTS);

attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
  instructions: "Custom narration instructions...",
  speechOptions: {
    voiceName: "Samantha",
    lang: "en-US",
    rate: 0.96,
    pitch: 1.0,
    volume: 1.0,
  },
  highlight: {
    mode: "span",
    color: "#fde68a",
    textColor: "#0f172a",
    radius: "0.6em",
    padding: "0.04em 0.24em",
  },
});
```

You can extract readable text from content using the same parser as `attachReadAloud()`:

```js
import { extractReadAloudText } from "@kigathi/ai-agents/browser";
const text = extractReadAloudText("#blog-content");
```

Source precedence is deterministic: `data` > `dataSource` > `endpoint`.
Re-read in timed mode resets playback to the beginning.
For long endpoint/dataSource text, progressive playback starts chunk 0 first and prefetches following chunks.

Add a highlight style:

```css
::highlight(readaloud-active) {
  background: #fde68a;
  color: inherit;
}
```

Timed read-aloud (`endpoint`, `dataSource`, or `data`) always uses non-mutating CSS highlights for stability.
Timed read-aloud auto-scroll defaults to enabled and follows active highlighting in the nearest scroll container (falls back to window).
Progressive mode applies to `endpoint` and `dataSource`; `data` mode remains single-payload.

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

## Complete read-aloud example (no endpoint)

```html
<article id="blog-content">
  <p>This package can now read blog content aloud.</p>
  <p>Words are highlighted without rewriting your DOM.</p>
</article>

<button id="read-aloud-trigger">Play/Pause</button>
```

```js
import { attachReadAloud } from "@kigathi/ai-agents";

attachReadAloud({
  content: "#blog-content",
  trigger: "#read-aloud-trigger",
});
```

## Optional OpenAI-backed read-aloud endpoint

```js
import express from "express";
import { createClient } from "@kigathi/ai-agents";

const app = express();
app.use(express.json({ limit: "2mb" }));

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/read-aloud", async (req, res) => {
  try {
    const { text, chunk_index, total_chunks, instructions } = req.body || {};
    const speech = await sdk.tts.speak({
      text,
      instructions,
      chunking: "auto", // default
      maxChunkChars: 1600,
      maxTotalChars: 120000,
      voice: "alloy",
      model: "gpt-4o-mini-tts",
      format: "mp3",
    });

    // chunk_index/total_chunks/instructions are optional metadata from progressive clients.
    res.json(speech);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to generate read-aloud audio." });
  }
});
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
- `sdk.tts.speak()` is direct-mode only (requires `apiKey`) and returns `audio_base64`, `mime_type`, and optional word timings.
- For large text, `sdk.tts.speak()` supports automatic chunking (`chunking: "auto"`) and merges chunk audio/timings into one payload.
- `attachReadAloud()` works without any endpoint by default (browser speech synthesis) and does not mutate your content DOM.
- `attachReadAloud({ endpoint })` switches to server/OpenAI-backed audio + timestamps.
- `attachReadAloud({ data })` accepts pre-fetched TTS payloads (`audio_base64`, `mime_type`, `words`) directly.
- `attachReadAloud({ dataSource })` lets you provide your own async timed source while retaining built-in progressive chunk orchestration; it accepts full timed payloads.
- `extractReadAloudText(content)` returns readable text from a selector/DOM element using the same content parsing as `attachReadAloud()`.
- Source precedence is deterministic: `data` > `dataSource` > `endpoint`.
- Migration note: timed mode (`endpoint`/`data`) now uses CSS highlights for stability and does not use span-wrapping.
- Auto-scroll can be toggled with a boolean shorthand (`autoScroll: false` / `autoScroll: true`) or configured via object options (`autoScroll.enabled`, `autoScroll.behavior`, `autoScroll.block`, `autoScroll.marginRatio`, `autoScroll.throttleMs`).
- Progressive options in `attachReadAloud`: `progressive.enabled`, `progressive.maxChunkChars`, `progressive.prefetchAhead`, `progressive.retryCount`, `progressive.retryDelayMs`.
- You can trace progressive chunk retries with `attachReadAloud({ debugHook: (event) => ... })`.
- Client retry behavior for OpenAI direct calls is configurable via `createClient({ maxRetries })`.
- Default minimal tuning: `maxChunkChars` is `1600`, client `maxRetries` is `0`, and progressive `retryCount` is `0`.
- Progressive playback is enabled for long endpoint/dataSource timed text by default (chunk 0 starts first, next chunks prefetch in background, boundary waits/retries if needed).
- In timed mode (`endpoint`, `dataSource`, or `data`), highlighting is CSS-based (DOM remains unwrapped) and strict accuracy-first: no synthetic/interpolated fallback timing is used.
- If synced timing words are unavailable/invalid, timed highlight does not run and an explicit timing error is surfaced.
