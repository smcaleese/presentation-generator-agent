# Message flow: frontend → backend → frontend

How one chat message travels from the input box to a streamed, reasoned reply.
Every snippet below is trimmed to the essentials; follow the file links for the
full source.

```
ChatPane (form)                     api/src/routes.ts
   │ onSend(text)                      POST /api/chats/:id/messages
   ▼                                        │
App.handleSend  ──fetch POST──▶  persist user Message ──▶ emit "message"
   │  (opens SSE reader)                    │              emit "chat:title"
   │                                        ▼
   │                              pipeline.runChatTurn(chatId, emit)
   │                                        │  load history
   │                                        ▼
   │                              llm.streamChat(history, handlers)
   │                                        │  DeepSeek stream
   │   ◀── data: {"type":"reasoning"} ──────┤  reasoning_content deltas
   │   ◀── data: {"type":"token"}     ──────┤  content deltas
   │                                        ▼
   │                              persist assistant Message
   │   ◀── data: {"type":"message"}   ──────┤
   │   ◀── data: {"type":"done"}      ──────┘
   ▼
App reduces events → setState → ChatPane re-renders
(reasoning panel above the answer bubble)
```

The transport is **Server-Sent Events** (SSE): one long-lived HTTP response, one
JSON object per `data:` line.

---

## 1. The user sends — `frontend/src/components/ChatPane.tsx`

The composer is a plain form. Enter (without Shift) and the send button both call
`submit`, which hands the text up via the `onSend` prop.

```tsx
function submit(e?: React.FormEvent) {
  e?.preventDefault();
  const text = draft.trim();
  if (!text || disabled) return;
  onSend(text);          // ← up to App
  setDraft("");
}

function onKeyDown(e: React.KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}
```

```tsx
<Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} … />
<Button type="submit" size="icon" disabled={disabled}><Send /></Button>
```

---

## 2. `App` opens the stream — `frontend/src/App.tsx`

`handleSend` flips the UI into "live turn" mode, clears the per-turn buffers, then
calls `sendMessage`, passing a callback that will fire once per SSE event.

```tsx
function handleSend(text: string) {
  if (!activeId) return;
  setBusy(true);
  setLiveTurn(true);
  setStatus("Thinking…");
  setReasoning("");
  setStreamingAnswer("");

  sendMessage(activeId, text, (e) => {
    switch (e.type) {
      case "reasoning": setReasoning((p) => p + e.text); break;
      case "token":     setStreamingAnswer((p) => p + e.text); break;
      case "message":
        setMessages((prev) => [...prev, e.message]);
        if (e.message.role === "assistant") {
          setLiveTurn(false);      // finalized message owns its reasoning panel now
          setStreamingAnswer("");
          setReasoning("");
        }
        break;
      case "chat:title":
        setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, title: e.title } : c)));
        break;
      case "error": setStatus(`Error: ${e.error}`); break;
      case "done":
        setBusy(false);
        setLiveTurn(false);
        setStatus(null);
        listChats().then(setChats).catch(() => {});   // refresh sidebar order
        break;
    }
  }).catch((err) => { setStatus(String(err)); setBusy(false); setLiveTurn(false); });
}
```

Key idea: **three pieces of state** drive the live turn —
`reasoning` (accumulated thinking), `streamingAnswer` (accumulated answer), and
`liveTurn` (is a turn streaming right now). They're all reset when the finalized
`message` arrives, because from then on the persisted message renders itself.

---

## 3. The fetch + SSE parser — `frontend/src/api.ts`

`sendMessage` POSTs the text and then reads the response body as a stream,
splitting on the SSE record separator (`\n\n`) and JSON-parsing each `data:` line.

```ts
export async function sendMessage(
  chatId: string,
  content: string,
  onEvent: (e: ServerEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.body) throw new Error("no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";          // keep the trailing partial record
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ServerEvent);
      } catch {
        /* ignore keep-alive / malformed lines */
      }
    }
  }
}
```

In dev, `/api/*` is proxied to `http://localhost:3001` by
`frontend/vite.config.ts`, so the relative URL just works.

---

## 4. The route — `api/src/routes.ts`

`POST /api/chats/:id/messages` opens the SSE response, persists the **user**
message, optionally names the chat, then delegates to `runChatTurn`. `emit` is
the single helper that serializes a `ServerEvent` onto the wire.

```ts
app.post("/api/chats/:id/messages", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { content } = z.object({ content: z.string().min(1) }).parse(req.body);

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",            // don't let a proxy buffer the stream
  });
  const emit = (e: ServerEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);

  const userMsg = await prisma.message.create({
    data: { chatId: id, role: "user", content },
  });
  emit({ type: "message", message: {
    id: userMsg.id, role: "user", content: userMsg.content,
    createdAt: userMsg.createdAt.toISOString(),
  }});

  if (chat.title === DEFAULT_TITLE) {             // first message names the chat
    const title = titleFrom(content);
    await prisma.chat.update({ where: { id }, data: { title } });
    emit({ type: "chat:title", title });
  }

  try {
    await runChatTurn(id, emit);
  } catch (err) {
    emit({ type: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    emit({ type: "done" });
    reply.raw.end();
  }
});
```

---

## 5. The turn — `api/src/pipeline.ts`

`runChatTurn` reads the full message history (the user message from step 4 is
already in it), streams a reply, forwards every token as an SSE event, then
persists the **assistant** message with its reasoning trace in `meta`.

```ts
export async function runChatTurn(chatId: string, emit: Emit): Promise<void> {
  const history = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });
  const turns: ChatTurn[] = history.map((m) => ({ role: m.role, content: m.content }));

  const { content, reasoning } = await streamChat(turns, {
    onReasoning: (text) => emit({ type: "reasoning", text }),
    onContent:   (text) => emit({ type: "token", text }),
  });

  const assistant = await prisma.message.create({
    data: { chatId, role: "assistant", content, meta: reasoning ? { reasoning } : undefined },
  });
  await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

  emit({ type: "message", message: {
    id: assistant.id, role: "assistant", content: assistant.content,
    reasoning: reasoning || undefined,
    createdAt: assistant.createdAt.toISOString(),
  }});
}
```

---

## 6. The model call — `api/src/llm.ts`

DeepSeek is OpenAI-compatible, so it's the stock `openai` client pointed at a
different `baseURL`. `streamChat` iterates the streamed deltas and separates
**reasoning** tokens from **answer** tokens.

```ts
// build the request — reasoning knobs are env-driven
function streamRequest(messages: Msg[]): OpenAI.Chat.ChatCompletionCreateParamsStreaming {
  const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming & Record<string, unknown> = {
    model: env.deepseek.model,                 // e.g. "deepseek-v4-flash"
    stream: true,
    messages,
  };
  if (env.deepseek.reasoningEffort !== "off") {
    params.reasoning_effort = env.deepseek.reasoningEffort;   // "low" | "medium" | "high"
    params.thinking = { type: "enabled" };     // DeepSeek V4 toggle (TS SDK has no extra_body)
  }
  return params;
}

// consume the stream — split reasoning deltas from answer deltas
async function consume(stream, handlers: StreamHandlers) {
  let content = "";
  let reasoning = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as ReasoningDelta | undefined;
    if (!delta) continue;

    // DeepSeek → reasoning_content, OpenRouter/others → reasoning
    const r = delta.reasoning_content ?? delta.reasoning;
    if (r) { reasoning += r; handlers.onReasoning?.(r); }
    if (delta.content) { content += delta.content; handlers.onContent?.(delta.content); }
  }
  return { content, reasoning };
}

export async function streamChat(history: ChatTurn[], handlers: StreamHandlers = {}) {
  const messages = [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...history];
  const stream = await llm.chat.completions.create(streamRequest(messages));
  return consume(stream, handlers);
}
```

`reasoning_content` left on assistant history messages is fine — DeepSeek ignores
it. This app keeps it in `Message.meta` and only replays `content` anyway.

So the causal chain for a single token is:

```
DeepSeek delta.reasoning_content
  → handlers.onReasoning(text)          (llm.ts)
  → emit({ type: "reasoning", text })   (pipeline.ts)
  → reply.raw.write("data: …\n\n")      (routes.ts)
  → onEvent({ type: "reasoning", … })   (api.ts)
  → setReasoning(prev => prev + text)   (App.tsx)
  → <ReasoningPanel> re-renders         (ChatPane.tsx)
```

---

## 7. Rendering — `frontend/src/components/ChatPane.tsx`

**Historical** assistant messages render their own reasoning panel *above* the
answer bubble (collapsed by default):

```tsx
{messages.map((m) =>
  m.role === "user" ? (
    <div className="ml-auto … bg-primary …">{m.content}</div>
  ) : (
    <div key={m.id} className="space-y-2">
      {m.reasoning && <ReasoningPanel text={m.reasoning} live={false} />}
      <div className="mr-auto … bg-muted …">{m.content}</div>
    </div>
  ),
)}
```

The **live** turn mirrors that layout — reasoning first, answer second — driven by
the per-turn buffers, and only while `liveTurn` is true:

```tsx
{liveTurn && (
  <div className="space-y-2">
    {(reasoning || thinking) && <ReasoningPanel text={reasoning} live={thinking} />}
    {streamingAnswer && (
      <div className="mr-auto … bg-muted …">
        {streamingAnswer}
        <span className="… animate-pulse …" />   {/* caret */}
      </div>
    )}
  </div>
)}
```

`ReasoningPanel` auto-expands and auto-scrolls while `live`, and collapses to a
one-line summary once the turn is done.

---

## 8. Persistence & reload

| What | Where it lives |
|---|---|
| user & assistant text | `Message.content` |
| assistant reasoning trace | `Message.meta.reasoning` (JSON) |
| chat title | `Chat.title` (auto-set from the first user message) |
| ordering in the sidebar | `Chat.updatedAt`, bumped each turn |

On load, `GET /api/chats/:id` re-hydrates the reasoning from `meta`:

```ts
messages: chat.messages.map((m) => ({
  id: m.id, role: m.role, content: m.content,
  reasoning:
    m.meta && typeof m.meta === "object" && "reasoning" in m.meta
      ? String((m.meta as { reasoning?: unknown }).reasoning ?? "")
      : undefined,
  createdAt: m.createdAt.toISOString(),
})),
```

so a refreshed page shows the same reasoning-above-answer layout with no live
stream involved.

---

## Event reference

Defined once in `api/src/types.ts` and mirrored in `frontend/src/types.ts`.

| Event | Payload | Emitted when | Frontend effect |
|---|---|---|---|
| `message` | `{ message: ChatMessage }` | user msg persisted; assistant msg persisted | append to `messages`; on assistant, end the live turn |
| `chat:title` | `{ title }` | first user message in a chat | rename in the sidebar |
| `reasoning` | `{ text }` | each thinking delta | `reasoning += text` |
| `token` | `{ text }` | each answer delta | `streamingAnswer += text` |
| `error` | `{ error }` | exception in the turn | show in the status line |
| `done` | — | stream is closing (always last) | clear buffers, re-enable input, refresh sidebar |
