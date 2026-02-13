import { createClient } from '@lyre/ai-agents';

let sdk: ReturnType<typeof createClient> | null = null;

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const body = await readBody(event);

  if (!body?.message || typeof body.message !== 'string') {
    throw createError({ statusCode: 422, statusMessage: '`message` is required.' });
  }

  if (!sdk) {
    sdk = createClient({
      backendUrl: config.axisBackendUrl,
      mode: 'proxy',
    });
  }

  return await sdk.run({
    agent: config.lyreAgentId,
    message: body.message,
    conversation_id: body.conversation_id ?? null,
    user_id: body.user_id ?? null,
    metadata: {
      client_app: 'nuxt-chat-sample',
      ...(body.metadata || {}),
    },
  });
});
