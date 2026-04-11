export async function getOpenAIClient(client) {
  if (client.config.mode !== "direct") {
    return null;
  }

  if (client.openai) {
    return client.openai;
  }

  const OpenAI = await resolveOpenAIConstructor();
  const isBrowser =
    typeof window !== "undefined" && typeof document !== "undefined";
  client.openai = new OpenAI({
    apiKey: client.config.apiKey,
    organization: client.config.orgId,
    project: client.config.projectId,
    ...(Number.isFinite(Number(client.config.maxRetries))
      ? { maxRetries: Math.max(0, Number(client.config.maxRetries)) }
      : {}),
    ...(isBrowser ? { dangerouslyAllowBrowser: true } : {}),
  });

  return client.openai;
}

export async function resolveOpenAIConstructor() {
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
