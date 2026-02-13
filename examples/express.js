import express from 'express';
import { createClient } from '@lyre/ai-agents';

const app = express();
app.use(express.json());

const sdk = createClient({ apiKey: process.env.OPENAI_API_KEY });

sdk.createAgent({
  name: 'ops-bot',
  model: 'gpt-4.1-mini',
  instructions: 'Answer operational questions.',
});

app.post('/chat', async (req, res) => {
  const result = await sdk.run({
    agent: 'ops-bot',
    message: req.body.message,
    conversation_id: req.body.conversation_id,
  });

  res.json(result);
});

app.listen(3000);
