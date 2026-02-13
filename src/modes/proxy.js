export async function runProxy(client, params) {
  const response = await fetch(`${client.config.backendUrl}/api/ai-agents/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) throw new Error(`Proxy run failed: ${response.status}`);
  return await response.json();
}

export async function* runStreamProxy(client, params) {
  const response = await fetch(`${client.config.backendUrl}/api/ai-agents/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Proxy stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}
