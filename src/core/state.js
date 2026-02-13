export function resolveConversationStateKey(agent, params) {
  if (params.conversation_key) {
    return String(params.conversation_key);
  }
  if (params.conversation_id !== null && params.conversation_id !== undefined) {
    return `conversation:${params.conversation_id}`;
  }

  const agentKey =
    typeof params.agent === "string" || typeof params.agent === "number"
      ? String(params.agent)
      : String(agent?.id ?? agent?.name ?? "default-agent");
  const userKey =
    params.user_id !== null && params.user_id !== undefined
      ? `user:${params.user_id}`
      : "user:anon";
  return `${agentKey}:${userKey}`;
}

export function getConversationState(client, key) {
  if (!client.conversationState.has(key)) {
    client.conversationState.set(key, {
      conversation_id: null,
      last_response_id: null,
      messages: [],
      persistence_chain: Promise.resolve(),
    });
  }
  return client.conversationState.get(key);
}

export function resolveMessagesForRequest(params, state) {
  if (Array.isArray(params.messages) && params.messages.length > 0) {
    return params.messages;
  }
  return Array.isArray(state.messages) ? state.messages : [];
}

export function updateConversationStateAfterCompletion(
  state,
  { userText, assistantText, conversationId, responseId, outputMessageId, maxHistory },
) {
  if (conversationId !== null && conversationId !== undefined) {
    state.conversation_id = conversationId;
  }

  const nextResponseId = responseId || outputMessageId || null;
  if (nextResponseId) {
    state.last_response_id = nextResponseId;
  }

  if (!userText && !assistantText) {
    return;
  }

  const messages = Array.isArray(state.messages) ? state.messages : [];
  if (userText) {
    messages.push({ role: "user", content: userText });
  }
  if (assistantText) {
    messages.push({ role: "assistant", content: assistantText });
  }

  const keep = Math.max(1, Number(maxHistory || 30));
  state.messages = messages.slice(-keep);
}
