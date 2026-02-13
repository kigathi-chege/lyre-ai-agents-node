import { createClient } from "@lyre/ai-agents";
import { env } from "$env/dynamic/private";

const sdk = createClient({ apiKey: env.OPENAI_API_KEY });

export async function POST({ request }) {
  const body = await request.json();
  const result = await sdk.run({
    agent: body.agent,
    message: body.message,
    conversation_id: body.conversation_id,
  });

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
}
