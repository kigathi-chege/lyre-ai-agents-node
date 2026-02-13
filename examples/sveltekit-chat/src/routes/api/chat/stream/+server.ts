import { createClient } from "@lyre/ai-agents";
import { env } from "$env/dynamic/private";

const sdk = createClient({
  backendUrl: env.AXIS_BACKEND_URL || "http://localhost:8000",
  apiKey: env.OPENAI_API_KEY,
});

export async function POST({ request }) {
  const body = await request.json();

  if (!body?.message || typeof body.message !== "string") {
    return new Response(JSON.stringify({ message: "`message` is required." }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send("status", { text: "Preprocessing context..." });

        const iterator = sdk.runStream({
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

        send("status", { text: "Model is responding..." });

        for await (const chunk of iterator) {
          send("delta", { text: chunk });
        }

        send("done", { ok: true });
      } catch (error) {
        send("error", { message: error?.message || "Streaming failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
