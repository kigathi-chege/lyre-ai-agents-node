<script setup lang="ts">
type ChatMessage = { role: 'user' | 'assistant'; text: string };

const isOpen = ref(false);
const isSending = ref(false);
const input = ref('');
const messages = ref<ChatMessage[]>([
  { role: 'assistant', text: 'Hi, how can I help you today?' },
]);

const storageKey = 'nuxt_chat_conversation_id';
const conversationId = ref<number | null>(
  process.client ? Number(localStorage.getItem(storageKey)) || null : null
);

const sendMessage = async () => {
  const text = input.value.trim();
  if (!text || isSending.value) return;

  input.value = '';
  messages.value.push({ role: 'user', text });
  isSending.value = true;

  try {
    const result = await $fetch('/api/chat', {
      method: 'POST',
      body: {
        message: text,
        conversation_id: conversationId.value,
        metadata: { session_source: 'widget' },
      },
    });

    if (result?.conversation_id) {
      conversationId.value = Number(result.conversation_id);
      if (process.client) localStorage.setItem(storageKey, String(conversationId.value));
    }

    messages.value.push({
      role: 'assistant',
      text: result?.output_text || 'No response text returned.',
    });
  } catch (error: any) {
    messages.value.push({
      role: 'assistant',
      text: error?.data?.message || error?.message || 'Request failed.',
    });
  } finally {
    isSending.value = false;
  }
};
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
    <div class="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 class="text-2xl font-bold">Nuxt + @lyre/ai-agents</h1>
      <p class="mt-1 text-sm text-slate-500">
        Proxied to Axis for threadless conversation persistence.
      </p>
    </div>
  </main>

  <button
    class="fixed bottom-4 right-4 inline-flex h-16 w-16 items-center justify-center rounded-full border border-gray-200 bg-black p-0 text-sm font-medium leading-5 text-white hover:bg-gray-700"
    type="button"
    @click="isOpen = !isOpen"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
    </svg>
  </button>

  <section v-if="isOpen" class="fixed bottom-[calc(4rem+1.5rem)] right-0 mr-4 h-[634px] w-[440px] rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-lg">
    <div class="flex flex-col space-y-1.5 pb-6">
      <h2 class="text-lg font-semibold tracking-tight">Chatbot</h2>
      <p class="text-sm leading-3 text-[#6b7280]">Powered by Lyre AI Agents</p>
    </div>

    <div class="h-[474px] overflow-y-auto pr-4">
      <div v-for="(message, idx) in messages" :key="idx" class="my-4 flex flex-1 gap-3 text-sm text-gray-600">
        <span class="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
          <span class="rounded-full border bg-gray-100 p-1">
            <svg v-if="message.role === 'assistant'" viewBox="0 0 24 24" height="20" width="20">
              <path fill="currentColor" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z" />
            </svg>
            <svg v-else viewBox="0 0 16 16" height="20" width="20">
              <path fill="currentColor" d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6 5c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Z" />
            </svg>
          </span>
        </span>
        <p class="leading-relaxed">
          <span class="block font-bold text-gray-700">{{ message.role === 'assistant' ? 'AI' : 'You' }}</span>
          {{ message.text }}
        </p>
      </div>
    </div>

    <div class="pt-3">
      <form class="flex items-center justify-center space-x-2" @submit.prevent="sendMessage">
        <input
          v-model="input"
          class="h-10 w-full rounded-md border border-[#e5e7eb] px-3 py-2 text-sm text-[#030712] placeholder-[#6b7280] focus:outline-none focus:ring-2 focus:ring-[#9ca3af]"
          placeholder="Type your message"
        />
        <button
          :disabled="isSending"
          class="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-[#f9fafb] hover:bg-[#111827E6] disabled:opacity-60"
        >
          {{ isSending ? 'Sending...' : 'Send' }}
        </button>
      </form>
    </div>
  </section>
</template>
