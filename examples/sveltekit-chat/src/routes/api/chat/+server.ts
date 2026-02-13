import { json } from "@sveltejs/kit";
import { createClient } from "@lyre/ai-agents";
import { env } from "$env/dynamic/private";

const sdk = createClient({
  backendUrl: env.AXIS_BACKEND_URL || "http://localhost:8000",
  apiKey: env.OPENAI_API_KEY,
});

export async function POST({ request }) {
  const body = await request.json();

  if (!body?.message || typeof body.message !== "string") {
    return json({ message: "`message` is required." }, { status: 422 });
  }

  try {
    const result = await sdk.run({
      agent: env.LYRE_AGENT_ID || "default-agent",
      message: body.message,
      conversation_id: body.conversation_id ?? null,
      replying_to: body.replying_to ?? null,
      previous_response_id: body.replying_to ?? null,
      user_id: body.user_id ?? null,
      metadata: {
        client_app: "sveltekit-chat-sample",
        ...(body.metadata || {}),
      },
    });

    return json(result);
  } catch (error: any) {
    return json(
      { message: error?.message || "Request failed." },
      { status: 500 },
    );
  }
}
