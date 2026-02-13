export async function maybeSyncEvent(client, event) {
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

export async function ingestEvent(client, body) {
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

export async function resolveRemoteAgent(client, input) {
  if (!client.config.backendUrl) return null;

  const key = String(input);
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
    return null;
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
