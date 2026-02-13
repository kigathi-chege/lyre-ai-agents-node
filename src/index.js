export function createClient(config = {}) {
  const mode = config.mode || (config.backendUrl && !config.apiKey ? 'proxy' : 'direct');

  const client = {
    config: {
      backendUrl: config.backendUrl,
      apiKey: config.apiKey,
      orgId: config.orgId,
      projectId: config.projectId,
      mode,
      pricing: config.pricing || {
        'gpt-4.1': { prompt_per_million: 2.0, completion_per_million: 8.0 },
        'gpt-4.1-mini': { prompt_per_million: 0.4, completion_per_million: 1.6 },
        'gpt-4.1-nano': { prompt_per_million: 0.1, completion_per_million: 0.4 },
      },
    },
    tools: new Map(),
    agents: new Map(),
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
    instructions: definition.instructions || '',
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

  if (client.config.mode === 'proxy') {
    const response = await fetch(`${client.config.backendUrl}/api/ai-agents/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) throw new Error(`Proxy run failed: ${response.status}`);
    return await response.json();
  }

  const agent = resolveAgent(client, params.agent);
  const openai = await getOpenAIClient(client);
  let history = normalizeMessages(agent, params);
  let finalResponse = null;

  for (let i = 0; i < (params.maxToolIterations || 8); i += 1) {
    finalResponse = await openai.responses.create({
      model: agent.model,
      input: history,
      tools: buildResponseTools(client, agent),
      temperature: agent.temperature,
      max_output_tokens: agent.max_output_tokens,
    });

    const functionCalls = (finalResponse.output || []).filter((item) => item.type === 'function_call');

    if (!functionCalls.length) {
      const text = extractOutputText(finalResponse);
      await maybeSyncEvent(client, {
        event_name: 'AgentRunCompleted',
        payload: {
          agent_id: agent.id,
          conversation_id: params.conversation_id,
          usage: finalResponse.usage,
        },
      });

      return {
        output_text: text,
        usage: {
          prompt_tokens: finalResponse.usage?.input_tokens || 0,
          completion_tokens: finalResponse.usage?.output_tokens || 0,
          total_tokens: finalResponse.usage?.total_tokens || 0,
        },
        cost_usd: calculateCost(
          client.config.pricing,
          agent.model,
          finalResponse.usage?.input_tokens || 0,
          finalResponse.usage?.output_tokens || 0
        ),
        raw: finalResponse,
      };
    }

    for (const call of functionCalls) {
      const tool = client.tools.get(call.name);
      const args = safeJson(call.arguments);

      let result;
      if (!tool || typeof tool.handler !== 'function') {
        result = { error: `Tool not registered: ${call.name}` };
      } else {
        result = await tool.handler(args, params.context || {});
      }

      await maybeSyncEvent(client, {
        event_name: 'AgentToolCalled',
        payload: {
          agent_id: agent.id,
          conversation_id: params.conversation_id,
          tool_name: call.name,
          tool_arguments: args,
          tool_result: result,
        },
      });

      history.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  throw new Error('Tool call loop exceeded max iterations');
}

export async function* runStream(clientOrSdk, params) {
  const client = clientOrSdk.raw || clientOrSdk;

  if (client.config.mode === 'proxy') {
    const response = await fetch(`${client.config.backendUrl}/api/ai-agents/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok || !response.body) throw new Error(`Proxy stream failed: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    return;
  }

  const agent = resolveAgent(client, params.agent);
  const openai = await getOpenAIClient(client);
  const stream = await openai.responses.stream({
    model: agent.model,
    input: normalizeMessages(agent, params),
    tools: buildResponseTools(client, agent),
    temperature: agent.temperature,
    max_output_tokens: agent.max_output_tokens,
  });

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      yield event.delta;
    }
  }

  const final = await stream.finalResponse();
  await maybeSyncEvent(client, {
    event_name: 'AgentRunCompleted',
    payload: {
      agent_id: agent.id,
      conversation_id: params.conversation_id,
      usage: final.usage,
    },
  });
}

function resolveAgent(client, input) {
  if (typeof input === 'object' && input?.model) return input;
  const resolved = client.agents.get(input);
  if (!resolved) throw new Error(`Unknown agent: ${input}`);
  return resolved;
}

function normalizeMessages(agent, params) {
  const maxHistory = params.max_history_messages || 30;
  const history = [...(params.messages || [])].slice(maxHistory * -1);

  if (agent.instructions) {
    history.unshift({
      role: 'system',
      content: [{ type: 'input_text', text: agent.instructions }],
    });
  }

  history.push({
    role: 'user',
    content: [{ type: 'input_text', text: params.message }],
  });

  return history;
}

function calculateCost(pricing, model, promptTokens, completionTokens) {
  const modelPricing = pricing[model];
  if (!modelPricing) return 0;

  const promptCost = (promptTokens / 1_000_000) * (modelPricing.prompt_per_million || 0);
  const completionCost = (completionTokens / 1_000_000) * (modelPricing.completion_per_million || 0);
  return Number((promptCost + completionCost).toFixed(8));
}

function buildResponseTools(client, agent) {
  const names = agent.tools?.length ? agent.tools : [...client.tools.keys()];

  return names
    .map((name) => client.tools.get(name) || { type: 'builtin', name })
    .map((tool) => {
      if (tool.type === 'builtin') return { type: tool.name };
      if (tool.type === 'api') {
        return {
          type: 'function',
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters_schema || { type: 'object', properties: {} },
        };
      }
      return {
        type: 'function',
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters_schema || { type: 'object', properties: {} },
      };
    });
}

function extractOutputText(response) {
  const output = response.output || [];
  const chunks = [];
  for (const item of output) {
    for (const c of item.content || []) {
      if (c.type === 'output_text' && c.text) chunks.push(c.text);
    }
  }
  return chunks.join('\n').trim();
}

function safeJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

async function maybeSyncEvent(client, event) {
  if (!client.config.backendUrl) return;

  try {
    await fetch(`${client.config.backendUrl}/api/ai-agents/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
  } catch {
    // Event sync is best effort.
  }
}

async function getOpenAIClient(client) {
  if (client.config.mode !== 'direct') {
    return null;
  }

  if (client.openai) {
    return client.openai;
  }

  const { default: OpenAI } = await import('openai');
  client.openai = new OpenAI({
    apiKey: client.config.apiKey,
    organization: client.config.orgId,
    project: client.config.projectId,
  });

  return client.openai;
}
