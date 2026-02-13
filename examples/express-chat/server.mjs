import dotenv from 'dotenv';
import express from 'express';
import { createClient } from '@lyre/ai-agents';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3100);

const sdk = createClient({
  backendUrl: process.env.AXIS_BACKEND_URL,
  mode: 'proxy',
});

app.use(express.json());
app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      conversation_id,
      user_id = null,
      metadata = {},
    } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(422).json({ message: '`message` is required.' });
    }

    const result = await sdk.run({
      agent: process.env.LYRE_AGENT_ID || 'default-agent',
      message,
      conversation_id: conversation_id ?? null,
      user_id,
      metadata: {
        client_app: 'express-chat-sample',
        ...metadata,
      },
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      message: error?.message || 'Chat request failed.',
    });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Express sample running on http://localhost:${port}`);
});
