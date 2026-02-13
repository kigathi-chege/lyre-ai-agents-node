import { resolveRemoteAgent } from "./backend.js";

export function registerTool(client, tool) {
  client.tools.set(tool.name, tool);
  return tool;
}

export function createAgent(client, definition) {
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
  client.agents.set(String(agent.id), agent);
  client.agents.set(agent.name, agent);
  return agent;
}

export async function resolveAgent(client, input) {
  if (typeof input === "object" && input?.model) return input;

  const key = String(input);
  const local = client.agents.get(input) || client.agents.get(key);
  if (local) return local;

  const remote = await resolveRemoteAgent(client, input);
  if (remote) return remote;

  throw new Error(`Unknown agent: ${input}`);
}
