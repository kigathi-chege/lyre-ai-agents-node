import { createClient } from '@lyre/ai-agents';

export default defineNuxtPlugin(() => {
  const sdk = createClient({ backendUrl: '/backend', mode: 'proxy' });
  return { provide: { aiAgents: sdk } };
});
