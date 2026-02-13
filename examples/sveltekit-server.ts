import { createClient } from '@lyre/ai-agents';

const sdk = createClient({ apiKey: process.env.OPENAI_API_KEY });

export async function POST({ request }) {
  const body = await request.json();
  const result = await sdk.run({
    agent: body.agent,
    message: body.message,
    conversation_id: body.conversation_id,
  });

  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
}
