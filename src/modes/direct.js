import { resolveAgent } from "../core/agents.js";
import { maybeSyncEvent } from "../core/backend.js";
import { getOpenAIClient } from "../core/openai.js";
import {
  buildResponseTools,
  calculateCost,
  extractOutputMessageId,
  extractOutputText,
  fireAndForget,
  normalizeMessages,
  safeJson,
} from "../core/helpers.js";
import {
  getConversationState,
  resolveConversationStateKey,
  resolveMessagesForRequest,
  updateConversationStateAfterCompletion,
} from "../core/state.js";
import {
  persistDirectAssistantMessage,
  persistDirectUserMessage,
} from "../core/persistence.js";

function enqueuePersistence(state, task, onResolved) {
  const previous = state.persistence_chain || Promise.resolve();
  const next = previous
    .then(task)
    .then((value) => {
      if (onResolved) {
        onResolved(value);
      }
      return value;
    })
    .catch(() => null);

  state.persistence_chain = next;
  return next;
}

export async function runDirect(client, params) {
  const agent = await resolveAgent(client, params.agent);
  const stateKey = resolveConversationStateKey(agent, params);
  const state = getConversationState(client, stateKey);
  const persistedConversationId = params.conversation_id ?? state.conversation_id ?? null;
  const previousResponseId =
    params.replying_to || params.previous_response_id || state.last_response_id || null;

  if (client.config.backendUrl) {
    const persistUser = enqueuePersistence(
      state,
      () =>
        persistDirectUserMessage(client, {
          agent,
          params,
          conversationId: persistedConversationId,
          replyingTo: previousResponseId,
        }),
      (resolvedConversationId) => {
        if (resolvedConversationId !== null && resolvedConversationId !== undefined) {
          state.conversation_id = resolvedConversationId;
        }
      },
    );
    fireAndForget(
      persistUser,
    );
  }

  const openai = await getOpenAIClient(client);
  let history = normalizeMessages(
    agent,
    {
      ...params,
      messages: resolveMessagesForRequest(params, state),
    },
    previousResponseId,
  );

  let finalResponse = null;
  for (let i = 0; i < (params.maxToolIterations || 8); i += 1) {
    finalResponse = await openai.responses.create({
      model: agent.model,
      instructions: agent.instructions || undefined,
      input: history,
      previous_response_id: previousResponseId && i === 0 ? previousResponseId : undefined,
      tools: buildResponseTools(client, agent),
      temperature: agent.temperature,
      max_output_tokens: agent.max_output_tokens,
    });

    const functionCalls = (finalResponse.output || []).filter(
      (item) => item.type === "function_call",
    );

    if (!functionCalls.length) {
      const text = extractOutputText(finalResponse);
      const responseId = finalResponse?.id || null;
      const outputMessageId = extractOutputMessageId(finalResponse);

      if (client.config.backendUrl) {
        const persistAssistant = enqueuePersistence(
          state,
          () =>
            persistDirectAssistantMessage(client, {
              agent,
              params,
              conversationId: persistedConversationId,
              response: finalResponse,
              responseId,
              outputMessageId,
              text,
            }),
          (resolvedConversationId) => {
            if (resolvedConversationId !== null && resolvedConversationId !== undefined) {
              state.conversation_id = resolvedConversationId;
            }
          },
        );
        fireAndForget(
          persistAssistant,
        );
      }

      updateConversationStateAfterCompletion(state, {
        userText: String(params.message || ""),
        assistantText: text,
        conversationId: persistedConversationId,
        responseId,
        outputMessageId,
        maxHistory: params.max_history_messages || 30,
      });

      return {
        conversation_id: persistedConversationId ?? state.conversation_id ?? null,
        output_text: text,
        response_id: responseId,
        output_message_id: outputMessageId,
        usage: {
          prompt_tokens: finalResponse.usage?.input_tokens || 0,
          completion_tokens: finalResponse.usage?.output_tokens || 0,
          total_tokens: finalResponse.usage?.total_tokens || 0,
        },
        cost_usd: calculateCost(
          client.config.pricing,
          agent.model,
          finalResponse.usage?.input_tokens || 0,
          finalResponse.usage?.output_tokens || 0,
        ),
        raw: finalResponse,
      };
    }

    for (const call of functionCalls) {
      const tool = client.tools.get(call.name);
      const args = safeJson(call.arguments);

      let result;
      if (!tool || typeof tool.handler !== "function") {
        result = { error: `Tool not registered: ${call.name}` };
      } else {
        result = await tool.handler(args, params.context || {});
      }

      fireAndForget(
        maybeSyncEvent(client, {
          event_name: "AgentToolCalled",
          payload: {
            agent_id: agent.id,
            conversation_id: persistedConversationId,
            tool_name: call.name,
            tool_arguments: args,
            tool_result: result,
          },
        }),
      );

      history.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  throw new Error("Tool call loop exceeded max iterations");
}

export async function* runStreamDirect(client, params) {
  const agent = await resolveAgent(client, params.agent);
  const stateKey = resolveConversationStateKey(agent, params);
  const state = getConversationState(client, stateKey);
  const persistedConversationId = params.conversation_id ?? state.conversation_id ?? null;
  const previousResponseId =
    params.replying_to || params.previous_response_id || state.last_response_id || null;

  if (client.config.backendUrl) {
    const persistUser = enqueuePersistence(
      state,
      () =>
        persistDirectUserMessage(client, {
          agent,
          params,
          conversationId: persistedConversationId,
          replyingTo: previousResponseId,
        }),
      (resolvedConversationId) => {
        if (resolvedConversationId !== null && resolvedConversationId !== undefined) {
          state.conversation_id = resolvedConversationId;
        }
      },
    );
    fireAndForget(
      persistUser,
    );
  }

  const openai = await getOpenAIClient(client);
  const stream = await openai.responses.stream({
    model: agent.model,
    instructions: agent.instructions || undefined,
    input: normalizeMessages(
      agent,
      {
        ...params,
        messages: resolveMessagesForRequest(params, state),
      },
      previousResponseId,
    ),
    previous_response_id: previousResponseId || undefined,
    tools: buildResponseTools(client, agent),
    temperature: agent.temperature,
    max_output_tokens: agent.max_output_tokens,
  });

  let text = "";
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      text += event.delta || "";
      yield event.delta;
    }
  }

  const final = await stream.finalResponse();
  const responseId = final?.id || null;
  const outputMessageId = extractOutputMessageId(final);

  if (client.config.backendUrl) {
    const persistAssistant = enqueuePersistence(
      state,
      () =>
        persistDirectAssistantMessage(client, {
          agent,
          params,
          conversationId: persistedConversationId,
          response: final,
          responseId,
          outputMessageId,
          text: text || extractOutputText(final),
        }),
      (resolvedConversationId) => {
        if (resolvedConversationId !== null && resolvedConversationId !== undefined) {
          state.conversation_id = resolvedConversationId;
        }
      },
    );
    fireAndForget(
      persistAssistant,
    );
  }

  updateConversationStateAfterCompletion(state, {
    userText: String(params.message || ""),
    assistantText: text || extractOutputText(final),
    conversationId: persistedConversationId,
    responseId,
    outputMessageId,
    maxHistory: params.max_history_messages || 30,
  });
}
