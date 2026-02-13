import { DEFAULT_PRICING } from "./core/defaults.js";
import { createAgent as createAgentImpl, registerTool as registerToolImpl } from "./core/agents.js";
import { runDirect, runStreamDirect } from "./modes/direct.js";
import { runProxy, runStreamProxy } from "./modes/proxy.js";

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
      pricing: config.pricing || DEFAULT_PRICING,
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
  return registerToolImpl(client, tool);
}

export function createAgent(clientOrSdk, definition) {
  const client = clientOrSdk.raw || clientOrSdk;
  return createAgentImpl(client, definition);
}

export async function run(clientOrSdk, params) {
  const client = clientOrSdk.raw || clientOrSdk;
  if (client.config.mode === "proxy") {
    return await runProxy(client, params);
  }

  return await runDirect(client, params);
}

export async function* runStream(clientOrSdk, params) {
  const client = clientOrSdk.raw || clientOrSdk;
  if (client.config.mode === "proxy") {
    yield* runStreamProxy(client, params);
    return;
  }

  yield* runStreamDirect(client, params);
}
