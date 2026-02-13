# @lyre/ai-agents

Unified Agents/Bots SDK for Responses API.

## Install

```bash
npm install @lyre/ai-agents openai
```

## Direct OpenAI mode

```js
import { createClient } from '@lyre/ai-agents';

const sdk = createClient({
  apiKey: process.env.OPENAI_API_KEY,
  orgId: process.env.OPENAI_ORG_ID,
  projectId: process.env.OPENAI_PROJECT_ID,
});

sdk.registerTool({
  name: 'lookup_order',
  type: 'function',
  description: 'Find order by order number',
  parameters_schema: {
    type: 'object',
    properties: { order_number: { type: 'string' } },
    required: ['order_number'],
  },
  handler: async ({ order_number }) => ({ order_number, status: 'processing' }),
});

sdk.createAgent({
  name: 'support-bot',
  model: 'gpt-4.1-mini',
  instructions: 'You are a concise support assistant.',
  tools: ['lookup_order'],
});

const result = await sdk.run({ agent: 'support-bot', message: 'Check order AX-4420' });
console.log(result.output_text);
```

## Streaming

```js
for await (const delta of sdk.runStream({
  agent: 'support-bot',
  message: 'Give me a short summary of today\'s ticket updates',
})) {
  process.stdout.write(delta);
}
```

## Backend proxy mode (frontend-safe)

```js
const sdk = createClient({
  backendUrl: 'https://api.example.com',
  mode: 'proxy',
});

const result = await sdk.run({
  agent: 'support-bot',
  message: 'Start claim #99',
  conversation_id: 1234,
});
```

## Full sample apps

- `../examples/lyre-ai-agents-node/express-chat` - Express server + Tailwind widget UI
- `../examples/lyre-ai-agents-node/nuxt-chat` - Nuxt 3 app + server API route + Tailwind
- `../examples/lyre-ai-agents-node/sveltekit-chat` - SvelteKit app + server endpoint + Tailwind

All three use `@lyre/ai-agents` in `proxy` mode against Axis backend so conversation/message/cost metadata stays in Axis.
