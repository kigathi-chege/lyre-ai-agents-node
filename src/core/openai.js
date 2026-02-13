export async function getOpenAIClient(client) {
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
