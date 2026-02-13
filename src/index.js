export function createClient(config = {}) {
  const mode =
    config.mode || (config.backendUrl && !config.apiKey ? "proxy" : "direct");

  const client = {
    config: {
      backendUrl: config.backendUrl,
      apiKey: config.apiKey,
      orgId: config.orgId,
      projectId: config.projectId,
      mode,
      pricing: config.pricing || {
        "gpt-4.1": { prompt_per_million: 2.0, completion_per_million: 8.0 },
        "gpt-4.1-mini": {
          prompt_per_million: 0.4,
          completion_per_million: 1.6,
        },
        "gpt-4.1-nano": {
          prompt_per_million: 0.1,
          completion_per_million: 0.4,
        },
      },
    },
    tools: new Map(),
    agents: new Map(),
    backendAgents: new Map(),
    conversationState: new Map(),
    openai: null,
  };

  return {
    registerTool: (tool) => registerTool(client, tool),
    createAgent: (agent) => createAgent(client, agent),
    run: (params) => run(client, params),
    runStream: (params) => runStream(client, params),
    raw: client,
  };
}

export function registerTool(clientOrSdk, tool) {
  const client = clientOrSdk.raw || clientOrSdk;
  client.tools.set(tool.name, tool);
  return tool;
}

export function createAgent(clientOrSdk, definition) {
  const client = clientOrSdk.raw || clientOrSdk;
  const agent = {
    id: definition.id || definition.name,
    name: definition.name,
    model: definition.model,
    instructions: definition.instructions || "",
    temperature: definition.temperature,
    max_output_tokens: definition.max_output_tokens,
    tools: definition.tools || [],
    metadata: definition.metadata || {},
  };

  client.agents.set(agent.id, agent);
  return agent;
}

export async function run(clientOrSdk, params) {
  const client = clientOrSdk.raw || clientOrSdk;

  if (client.config.mode === "proxy") {
    const response = await fetch(
      `${client.config.backendUrl}/api/ai-agents/run`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      },
    );

    if (!response.ok) throw new Error(`Proxy run failed: ${response.status}`);
    return await response.json();
  }

  const agent = await resolveAgent(client, params.agent);
  const stateKey = resolveConversationStateKey(agent, params);
  const state = getConversationState(client, stateKey);
  const persistedConversationId = params.conversation_id ?? state.conversation_id ?? null;
  const previousResponseId =
    params.replying_to || params.previous_response_id || state.last_response_id || null;

  if (client.config.backendUrl) {
    fireAndForget(persistDirectUserMessage(client, {
      agent,
      params,
      conversationId: persistedConversationId,
      replyingTo: previousResponseId,
    }));
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
        fireAndForget(persistDirectAssistantMessage(client, {
          agent,
          params,
          conversationId: persistedConversationId,
          response: finalResponse,
          responseId,
          outputMessageId,
          text,
        }));
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

      fireAndForget(maybeSyncEvent(client, {
        event_name: "AgentToolCalled",
        payload: {
          agent_id: agent.id,
          conversation_id: persistedConversationId,
          tool_name: call.name,
          tool_arguments: args,
          tool_result: result,
        },
      }));

      history.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  throw new Error("Tool call loop exceeded max iterations");
}

export async function* runStream(clientOrSdk, params) {
  const client = clientOrSdk.raw || clientOrSdk;

  if (client.config.mode === "proxy") {
    const response = await fetch(
      `${client.config.backendUrl}/api/ai-agents/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      },
    );

    if (!response.ok || !response.body)
      throw new Error(`Proxy stream failed: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    return;
  }

  const agent = await resolveAgent(client, params.agent);
  const stateKey = resolveConversationStateKey(agent, params);
  const state = getConversationState(client, stateKey);
  const persistedConversationId = params.conversation_id ?? state.conversation_id ?? null;
  const previousResponseId =
    params.replying_to || params.previous_response_id || state.last_response_id || null;

  if (client.config.backendUrl) {
    fireAndForget(persistDirectUserMessage(client, {
      agent,
      params,
      conversationId: persistedConversationId,
      replyingTo: previousResponseId,
    }));
  }
  const openai = await getOpenAIClient(client);
  const stream = await openai.responses.stream({
    model: agent.model,
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
    fireAndForget(persistDirectAssistantMessage(client, {
      agent,
      params,
      conversationId: persistedConversationId,
      response: final,
      responseId,
      outputMessageId,
      text: text || extractOutputText(final),
    }));
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

function normalizeMessages(agent, params, previousResponseId = null) {
  if (previousResponseId) {
    const input = [];
    if (agent.instructions) {
      input.push({
        role: "system",
        content: [{ type: "input_text", text: agent.instructions }],
      });
    }
    input.push({
      role: "user",
      content: [{ type: "input_text", text: params.message }],
    });
    return input;
  }

  const maxHistory = params.max_history_messages || 30;
  const history = [...(params.messages || [])].slice(maxHistory * -1);

  if (agent.instructions) {
    history.unshift({
      role: "system",
      content: [{ type: "input_text", text: agent.instructions }],
    });
  }

  history.push({
    role: "user",
    content: [{ type: "input_text", text: params.message }],
  });

  return history;
}

function calculateCost(pricing, model, promptTokens, completionTokens) {
  const modelPricing = pricing[model];
  if (!modelPricing) return 0;

  const promptCost =
    (promptTokens / 1_000_000) * (modelPricing.prompt_per_million || 0);
  const completionCost =
    (completionTokens / 1_000_000) * (modelPricing.completion_per_million || 0);
  return Number((promptCost + completionCost).toFixed(8));
}

function buildResponseTools(client, agent) {
  const names = agent.tools?.length ? agent.tools : [...client.tools.keys()];

  return names
    .map((name) => client.tools.get(name) || { type: "builtin", name })
    .map((tool) => {
      if (tool.type === "builtin") return { type: tool.name };
      if (tool.type === "api") {
        return {
          type: "function",
          name: tool.name,
          description: tool.description || "",
          parameters: tool.parameters_schema || {
            type: "object",
            properties: {},
          },
        };
      }
      return {
        type: "function",
        name: tool.name,
        description: tool.description || "",
        parameters: tool.parameters_schema || {
          type: "object",
          properties: {},
        },
      };
    });
}

function extractOutputText(response) {
  const output = response.output || [];
  const chunks = [];
  for (const item of output) {
    for (const c of item.content || []) {
      if (c.type === "output_text" && c.text) chunks.push(c.text);
    }
  }
  return chunks.join("\n").trim();
}

function resolveConversationStateKey(agent, params) {
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
  const userKey = params.user_id !== null && params.user_id !== undefined ? `user:${params.user_id}` : "user:anon";
  return `${agentKey}:${userKey}`;
}

function getConversationState(client, key) {
  if (!client.conversationState.has(key)) {
    client.conversationState.set(key, {
      conversation_id: null,
      last_response_id: null,
      messages: [],
    });
  }
  return client.conversationState.get(key);
}

function resolveMessagesForRequest(params, state) {
  if (Array.isArray(params.messages) && params.messages.length > 0) {
    return params.messages;
  }
  return Array.isArray(state.messages) ? state.messages : [];
}

function updateConversationStateAfterCompletion(
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

function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

async function maybeSyncEvent(client, event) {
  if (!client.config.backendUrl) return;

  try {
    await fetch(`${client.config.backendUrl}/api/ai-agents/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  } catch {
    // Event sync is best effort.
  }
}

function fireAndForget(promise) {
  promise.catch(() => {
    // Persistence/event ingestion is best-effort in async mode.
  });
}

function extractOutputMessageId(response) {
  const output = response?.output || [];
  const message = output.find((item) => item?.type === "message" && item?.id);
  return message?.id || null;
}

async function getOpenAIClient(client) {
  if (client.config.mode !== "direct") {
    return null;
  }

  if (client.openai) {
    return client.openai;
  }

  const OpenAI = await resolveOpenAIConstructor();
  client.openai = new OpenAI({
    apiKey: client.config.apiKey,
    organization: client.config.orgId,
    project: client.config.projectId,
  });

  return client.openai;
}

async function resolveOpenAIConstructor() {
  try {
    const mod = await import("openai");
    return mod.default || mod.OpenAI || mod;
  } catch (firstError) {
    try {
      const { createRequire } = await import("node:module");
      const requireFromCwd = createRequire(`${process.cwd()}/package.json`);
      const mod = requireFromCwd("openai");
      return mod.default || mod.OpenAI || mod;
    } catch {
      throw new Error(
        "Failed to load `openai` package for direct mode. Install it in the consuming app (`npm i openai`) or use proxy mode.",
        { cause: firstError },
      );
    }
  }
}

async function resolveAgent(client, input) {
  if (typeof input === "object" && input?.model) return input;

  const key = String(input);
  const local = client.agents.get(input) || client.agents.get(key);
  if (local) return local;

  if (client.config.backendUrl) {
    const cached = client.backendAgents.get(key);
    if (cached) return cached;

    const response = await fetch(
      `${client.config.backendUrl}/api/ai-agents/agents/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: input }),
      },
    );

    if (!response.ok) {
      throw new Error(`Unknown agent: ${input}`);
    }

    const remote = await response.json();
    const resolved = {
      id: remote.id ?? input,
      name: remote.name ?? key,
      model: remote.model,
      instructions: remote.instructions || "",
      temperature: remote.temperature,
      max_output_tokens: remote.max_output_tokens,
      tools: remote.tools || [],
      metadata: remote.metadata || {},
    };

    client.backendAgents.set(key, resolved);
    if (resolved.id !== undefined && resolved.id !== null) {
      client.backendAgents.set(String(resolved.id), resolved);
    }
    return resolved;
  }

  throw new Error(`Unknown agent: ${input}`);
}

async function ingestEvent(client, body) {
  if (!client.config.backendUrl) return null;

  const response = await fetch(`${client.config.backendUrl}/api/ai-agents/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return null;
  }

  return await response.json();
}

async function persistDirectUserMessage(client, { agent, params, conversationId, replyingTo }) {
  const idempotencyKey =
    params.idempotency_key ||
    `user:${agent.id}:${conversationId || "new"}:${replyingTo || "none"}:${String(params.message || "").trim()}`;

  const res = await ingestEvent(client, {
    event_name: "agent.message.upsert",
    idempotency_key: idempotencyKey,
    process_now: true,
    agent_id: Number.isFinite(Number(agent.id)) ? Number(agent.id) : null,
    conversation_id: conversationId ?? null,
    payload: {
      agent_id: Number.isFinite(Number(agent.id)) ? Number(agent.id) : null,
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

async function persistDirectAssistantMessage(
  client,
  { agent, params, conversationId, response, responseId, outputMessageId, text },
) {
  const usage = response?.usage || {};
  const idempotencyKey =
    params.idempotency_key_response || `assistant:${agent.id}:${conversationId || "new"}:${responseId || outputMessageId || text}`;

  const res = await ingestEvent(client, {
    event_name: "agent.message.upsert",
    idempotency_key: idempotencyKey,
    process_now: true,
    agent_id: Number.isFinite(Number(agent.id)) ? Number(agent.id) : null,
    conversation_id: conversationId ?? null,
    payload: {
      agent_id: Number.isFinite(Number(agent.id)) ? Number(agent.id) : null,
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
