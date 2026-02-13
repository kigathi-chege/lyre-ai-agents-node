<script lang="ts">
  type ChatMessage = { role: "assistant" | "user"; text: string };

  let isOpen = false;
  let isSending = false;
  let input = "";
  let useStreaming = true;
  let statusText = "";
  let lastReplyingTo: string | null = null;
  let messages: ChatMessage[] = [{ role: "assistant", text: "Hi, how can I help you today?" }];
  let conversationId: number | null = null;

  if (typeof localStorage !== "undefined") {
    conversationId = Number(localStorage.getItem("sveltekit_chat_conversation_id")) || null;
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isSending) return;

    input = "";
    messages = [...messages, { role: "user", text }];
    isSending = true;
    statusText = "Preprocessing context...";

    try {
      if (useStreaming) {
        await sendStream(text);
      } else {
        await sendRun(text);
      }
    } catch (error: any) {
      messages = [...messages, { role: "assistant", text: error?.message || "Network error." }];
    } finally {
      isSending = false;
      statusText = "";
    }
  }

  async function sendRun(text: string) {
    statusText = "Calling model...";
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        conversation_id: conversationId,
        replying_to: lastReplyingTo,
        metadata: { session_source: "widget" },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      messages = [...messages, { role: "assistant", text: data?.message || "Request failed." }];
      return;
    }

    if (data?.conversation_id) {
      conversationId = Number(data.conversation_id);
      localStorage.setItem("sveltekit_chat_conversation_id", String(conversationId));
    }

    if (data?.response_id) {
      lastReplyingTo = data.response_id;
    } else if (data?.output_message_id) {
      lastReplyingTo = data.output_message_id;
    }

    messages = [...messages, { role: "assistant", text: data?.output_text || "No response text returned." }];
  }

  async function sendStream(text: string) {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        conversation_id: conversationId,
        replying_to: lastReplyingTo,
        metadata: { session_source: "widget" },
      }),
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      throw new Error(body || "Streaming request failed.");
    }

    let assistantIndex = messages.length;
    messages = [...messages, { role: "assistant", text: "" }];

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let splitIndex;
      while ((splitIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);

        const eventMatch = frame.match(/^event:\s*(.+)$/m);
        const dataMatch = frame.match(/^data:\s*(.+)$/m);
        if (!eventMatch || !dataMatch) continue;

        const eventType = eventMatch[1].trim();
        let payload: any = {};
        try {
          payload = JSON.parse(dataMatch[1]);
        } catch {
          payload = {};
        }

        if (eventType === "status") {
          statusText = payload?.text || "Working...";
        } else if (eventType === "delta") {
          const chunk = payload?.text || "";
          messages[assistantIndex].text += chunk;
          messages = [...messages];
        } else if (eventType === "done") {
          statusText = "";
        } else if (eventType === "error") {
          messages[assistantIndex].text = payload?.message || "Streaming failed.";
          messages = [...messages];
        }
      }
    }
  }
</script>

<main class="mx-auto flex min-h-screen max-w-5xl items-center justify-center p-6">
  <div class="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
    <h1 class="text-2xl font-bold">SvelteKit + @lyre/ai-agents</h1>
    <p class="mt-1 text-sm text-slate-500">Messages are persisted in Axis conversations/messages.</p>
  </div>
</main>

<button
  class="fixed bottom-4 right-4 inline-flex h-16 w-16 items-center justify-center rounded-full border border-gray-200 bg-black p-0 text-sm font-medium leading-5 text-white hover:bg-gray-700"
  type="button"
  on:click={() => (isOpen = !isOpen)}
>
  <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"></path>
  </svg>
</button>

{#if isOpen}
  <section class="fixed bottom-[calc(4rem+1.5rem)] right-0 mr-4 h-[634px] w-[440px] rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-lg">
    <div class="flex flex-col space-y-1.5 pb-6">
      <h2 class="text-lg font-semibold tracking-tight">Chatbot</h2>
      <p class="text-sm leading-3 text-[#6b7280]">Powered by Lyre AI Agents</p>
      <div class="mt-3 flex items-center gap-2 text-xs">
        <button
          type="button"
          class={`rounded px-2 py-1 ${useStreaming ? "bg-black text-white" : "bg-slate-100 text-slate-700"}`}
          on:click={() => (useStreaming = true)}
        >
          Stream
        </button>
        <button
          type="button"
          class={`rounded px-2 py-1 ${!useStreaming ? "bg-black text-white" : "bg-slate-100 text-slate-700"}`}
          on:click={() => (useStreaming = false)}
        >
          Run
        </button>
      </div>
      {#if statusText}
        <p class="mt-2 text-xs text-slate-500">{statusText}</p>
      {/if}
    </div>

    <div class="h-[474px] overflow-y-auto pr-4">
      {#each messages as message}
        <div class="my-4 flex flex-1 gap-3 text-sm text-gray-600">
          <span class="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
            <span class="rounded-full border bg-gray-100 p-1">
              {#if message.role === 'assistant'}
                <svg viewBox="0 0 24 24" height="20" width="20">
                  <path fill="currentColor" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z" />
                </svg>
              {:else}
                <svg viewBox="0 0 16 16" height="20" width="20">
                  <path fill="currentColor" d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6 5c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Z" />
                </svg>
              {/if}
            </span>
          </span>
          <p class="leading-relaxed">
            <span class="block font-bold text-gray-700">{message.role === 'assistant' ? 'AI' : 'You'}</span>
            {message.text}
          </p>
        </div>
      {/each}
    </div>

    <div class="pt-3">
      <form class="flex items-center justify-center space-x-2" on:submit|preventDefault={sendMessage}>
        <input
          bind:value={input}
          class="h-10 w-full rounded-md border border-[#e5e7eb] px-3 py-2 text-sm text-[#030712] placeholder-[#6b7280] focus:outline-none focus:ring-2 focus:ring-[#9ca3af]"
          placeholder="Type your message"
        />
        <button
          disabled={isSending}
          class="inline-flex h-10 items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-[#f9fafb] hover:bg-[#111827E6] disabled:opacity-60"
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  </section>
{/if}
