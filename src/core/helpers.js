export function normalizeMessages(agent, params, previousResponseId = null) {
  if (previousResponseId) {
    return [{
      role: "user",
      content: [{ type: "input_text", text: params.message }],
    }];
  }

  const maxHistory = params.max_history_messages || 30;
  const history = [...(params.messages || [])].slice(maxHistory * -1);

  history.push({
    role: "user",
    content: [{ type: "input_text", text: params.message }],
  });

  return history;
}

export function calculateCost(pricing, model, promptTokens, completionTokens) {
  const modelPricing = pricing[model];
  if (!modelPricing) return 0;

  const promptCost =
    (promptTokens / 1_000_000) * (modelPricing.prompt_per_million || 0);
  const completionCost =
    (completionTokens / 1_000_000) * (modelPricing.completion_per_million || 0);
  return Number((promptCost + completionCost).toFixed(8));
}

export function buildResponseTools(client, agent) {
  const names = agent.tools?.length ? agent.tools : [...client.tools.keys()];

  return names
    .map((name) => client.tools.get(name) || { type: "builtin", name })
    .map((tool) => {
      if (tool.type === "builtin") return { type: tool.name };
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

export function extractOutputText(response) {
  const output = response.output || [];
  const chunks = [];
  for (const item of output) {
    for (const c of item.content || []) {
      if (c.type === "output_text" && c.text) chunks.push(c.text);
    }
  }
  return chunks.join("\n").trim();
}

export function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

export function extractOutputMessageId(response) {
  const output = response?.output || [];
  const message = output.find((item) => item?.type === "message" && item?.id);
  return message?.id || null;
}

export function fireAndForget(promise) {
  promise.catch(() => {
    // Persistence/event ingestion is best-effort in async mode.
  });
}
