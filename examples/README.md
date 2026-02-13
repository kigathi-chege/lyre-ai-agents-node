# Examples

Production-style sample apps using `@lyre/ai-agents` in proxy mode (Axis backend):

- `express-chat`
- `nuxt-chat`
- `sveltekit-chat`

Each sample:

- Uses a Tailwind chat widget UI
- Sends `conversation_id` on follow-up turns to maintain context
- Sends metadata (`client_app`, `session_source`) for Axis-side event/audit flow
