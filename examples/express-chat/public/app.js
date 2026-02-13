const openButton = document.getElementById('chat-open');
const panel = document.getElementById('chat-panel');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const messagesEl = document.getElementById('chat-messages');

let conversationId = Number(localStorage.getItem('express_chat_conversation_id')) || null;

function avatar(role) {
  return role === 'assistant'
    ? `<svg viewBox="0 0 24 24" height="20" width="20"><path fill="currentColor" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z"/></svg>`
    : `<svg viewBox="0 0 16 16" height="20" width="20"><path fill="currentColor" d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6 5c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Z"/></svg>`;
}

function appendMessage(role, text) {
  const label = role === 'assistant' ? 'AI' : 'You';
  const wrapper = document.createElement('div');
  wrapper.className = 'my-4 flex flex-1 gap-3 text-sm text-gray-600';
  wrapper.innerHTML = `
    <span class="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
      <span class="rounded-full border bg-gray-100 p-1">${avatar(role)}</span>
    </span>
    <p class="leading-relaxed">
      <span class="block font-bold text-gray-700">${label}</span>${text}
    </p>
  `;
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

openButton.addEventListener('click', () => {
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden') && messagesEl.children.length === 0) {
    appendMessage('assistant', 'Hi, how can I help you today?');
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  appendMessage('user', message);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
        metadata: {
          session_source: 'widget',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      appendMessage('assistant', data?.message || 'Request failed.');
      return;
    }

    if (data?.conversation_id) {
      conversationId = Number(data.conversation_id);
      localStorage.setItem('express_chat_conversation_id', String(conversationId));
    }

    appendMessage('assistant', data?.output_text || 'No response text returned.');
  } catch (error) {
    appendMessage('assistant', error?.message || 'Network error.');
  }
});
