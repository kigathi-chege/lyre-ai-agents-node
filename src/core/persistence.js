import { ingestEvent } from "./backend.js";

function asNumericId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function persistDirectUserMessage(
  client,
  { agent, params, conversationId, replyingTo },
) {
  const idempotencyKey =
    params.idempotency_key ||
    `user:${agent.id}:${conversationId || "new"}:${replyingTo || "none"}:${String(
      params.message || "",
    ).trim()}`;

  const res = await ingestEvent(client, {
    event_name: "agent.message.upsert",
    idempotency_key: idempotencyKey,
    process_now: true,
    agent_id: asNumericId(agent.id),
    conversation_id: conversationId ?? null,
    payload: {
      agent_id: asNumericId(agent.id),
      conversation_id: conversationId ?? null,
      external_id: replyingTo || undefined,
      role: "user",
      message: params.message,
      user_id: params.user_id ?? null,
      metadata: params.metadata || {},
      source_message_id: params.client_message_id || null,
    },
    metadata: params.metadata || {},
  });

  return res?.conversation_id ?? conversationId ?? null;
}

export async function persistDirectAssistantMessage(
  client,
  { agent, params, conversationId, response, responseId, outputMessageId, text },
) {
  const usage = response?.usage || {};
  const idempotencyKey =
    params.idempotency_key_response ||
    `assistant:${agent.id}:${conversationId || "new"}:${responseId || outputMessageId || text}`;

  const res = await ingestEvent(client, {
    event_name: "agent.message.upsert",
    idempotency_key: idempotencyKey,
    process_now: true,
    agent_id: asNumericId(agent.id),
    conversation_id: conversationId ?? null,
    payload: {
      agent_id: asNumericId(agent.id),
      conversation_id: conversationId ?? null,
      external_id: responseId || undefined,
      role: "assistant",
      message: text,
      model: agent.model,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
      source_message_id: outputMessageId || responseId || null,
      metadata: {
        ...(params.metadata || {}),
        openai_response_id: responseId || null,
        openai_message_id: outputMessageId || null,
      },
    },
    metadata: params.metadata || {},
  });

  return res?.conversation_id ?? conversationId ?? null;
}
