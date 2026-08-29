# Message flow: frontend → backend → frontend

How one message travels from the input box to a rendered deck. This doc focuses
on the **streaming mechanism**; the build/render internals are in
[DAYTONA_WORKFLOW.md](DAYTONA_WORKFLOW.md). Snippets are trimmed — follow the file
links for full source.

```
ChatPane (form)                     api/src/routes.ts
   │ onSend(text)                      POST /api/chats/:id/messages
   ▼                                        │
App.handleSend  ──fetch POST──▶  persist user Message ──▶ emit "message"
   │  (opens SSE reader)                    │              emit "chat:title"
   │                                        ▼
   │                              pipeline.runTurn(chatId, prompt, emit)   ── agent loop
   │   ◀── reasoning / token / code ────────┤  streamAgentStep → DeepSeek Responses API
   │   ◀── build:start / build:progress ────┤  createSlides → sandbox → deck.pptx
   │   ◀── build:progress ──────────────────┤  API: pptx → pdf → slide PNGs
   │   ◀── build:done { deck } ─────────────┤  DeckVersion + Slide rows
   │   ◀── message "<the model's summary>"
   │   ◀── done ────────────────────────────┘
   ▼
App reduces events → setState → SlideViewer renders the slide PNGs
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
message, optionally names the chat, then delegates to `runTurn`. `emit` is
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
    await runTurn(id, content, emit);        // never throws — records its own errors
  } catch (err) {
    emit({ type: "error", error: err instanceof Error ? err.message : String(err) });
  } finally {
    emit({ type: "done" });
    reply.raw.end();
  }
});
```

---

## 5. The agent loop — `api/src/pipeline.ts` `runTurn`

Builds the Responses `input[]`, then loops: stream a model step; if it calls
`createSlides`, run the build and feed the result back; otherwise the prose is the
final answer. Full internals in [DAYTONA_WORKFLOW.md](DAYTONA_WORKFLOW.md).

```ts
export async function runTurn(chatId, userPrompt, emit): Promise<void> {
  const input: InputItem[] = [];
  // inject the current deck's program (for edits) + prior turns.
  // assistant turns replay their stored `reasoning` items (required with tools).
  for (const m of history) {
    if (m.role === "assistant") {
      if (Array.isArray(m.meta?.reasoningItems)) input.push(...m.meta.reasoningItems);
      input.push({ role: "assistant", content: m.content });
    } else input.push({ role: "user", content: m.content });
  }
  input.push({ role: "user", content: userPrompt });

  for (let step = 0; step < MAX_STEPS; step++) {
    const { text, reasoningText, outputItems, tool } = await streamAgentStep(input, {
      onReasoning: (t) => emit({ type: "reasoning", text: t }),
      onText:      (t) => emit({ type: "token", text: t }),   // the prose reply
      onCode:      (t) => emit({ type: "code", text: t }),    // tool-call arg fragments
    });
    lastReasoningItems = outputItems;                          // persisted on the final message

    if (!tool) {                              // no build — done
      await persist(text.trim() || "Done.");
      return;
    }

    emit({ type: "code", text: tool.code, replace: true });   // clean parsed code
    const outcome = await runBuild(chatId, tool.code, emit);  // sandbox → render → DeckVersion, emits build:*

    input.push(...outputItems);                                       // reasoning items + function_call
    input.push({ type: "function_call_output", call_id: tool.callId, output: outcome.toolResult });
  }
}
```

`outcome.toolResult` is `"Success: built deck v3 with 5 slides."` or
`"Error — your program did not produce slides:\n<stderr>\n…call createSlides again."`
— so a failed build loops back to the model with the error.

---

## 6. The model call — `api/src/llm.ts` `streamAgentStep`

DeepSeek's **Responses API**, streaming, with the `createSlides` tool.

```ts
const params = {
  model: env.deepseek.model,
  instructions: INSTRUCTIONS,          // system prompt
  input,                               // messages + function_call + function_call_output + reasoning items
  tools: [createSlidesTool], tool_choice: "auto",
  stream: true,
};
if (env.deepseek.reasoningEffort !== "off")
  params.reasoning = { effort: env.deepseek.reasoningEffort };   // low | high | max

for await (const event of stream) {
  switch (event.type) {
    case "response.reasoning_text.delta":            reasoningText += event.delta; handlers.onReasoning?.(event.delta); break;
    case "response.output_text.delta":              text += event.delta;         handlers.onText?.(event.delta);      break;
    case "response.function_call_arguments.delta":  handlers.onCode?.(event.delta);                                   break;
    case "response.completed":                      outputItems = event.response.output;                             break;
  }
}
const fc = outputItems.find((it) => it.type === "function_call");
// JSON.parse(fc.arguments).code  →  the python-pptx program
```

Per DeepSeek's contract: the API is **stateless** (no `previous_response_id`), so
the whole `input` is resent each step, and — because tools are enabled — the
model's `reasoning` output items must be replayed both in-loop and across user
turns (`runTurn` stores them in `Message.meta.reasoningItems`) or the request
400s.

Causal chain for one reasoning token:

```
event "response.reasoning_text.delta"
  → handlers.onReasoning(event.delta)   (llm.ts)
  → emit({ type: "reasoning", text })   (pipeline.ts)
  → reply.raw.write("data: …\n\n")      (routes.ts)
  → onEvent({ type: "reasoning", … })   (api.ts)
  → setReasoning(prev => prev + text)   (App.tsx)
  → <StreamPanel label="Reasoning"> re-renders   (ChatPane.tsx)
```

---

## 7. Rendering — `frontend/src/components/ChatPane.tsx`

Each assistant turn renders as **two collapsible panels then a prose bubble**.
`StreamPanel` is one component (label + monospace `<pre>`), auto-open while `live`,
auto-scrolling, collapsed once done.

```tsx
// historical assistant message
<div key={m.id} className="space-y-2">
  {m.reasoning && <StreamPanel label="Reasoning" text={m.reasoning} />}
  {m.code      && <StreamPanel label="Code" text={m.code} mono />}
  <div className="mr-auto … bg-muted …">{m.content}</div>
</div>

// live turn — reasoning, then code, then the streaming reply
{liveTurn && (
  <>
    <StreamPanel label="Reasoning" text={reasoning} live={!codeStarted && !streamingText} badge="thinking…" />
    {codeStarted && <StreamPanel label="Code" text={streamingCode} live={!streamingText} mono badge="writing…" />}
    {streamingText && <div className="mr-auto … bg-muted …">{streamingText}<span className="…animate-pulse…" /></div>}
  </>
)}
```

The raw `python-pptx` never lands in a chat bubble — only the model's prose does.

---

## 8. Persistence & reload

| What | Where it lives |
|---|---|
| user & assistant text | `Message.content` |
| assistant reasoning text (for the UI) | `Message.meta.reasoning` |
| assistant `reasoning` output items (for replay) | `Message.meta.reasoningItems` |
| the turn's python-pptx program | `Message.meta.buildCode` (and `DeckVersion.buildCode`) |
| chat title | `Chat.title` (auto-set from the first user message) |
| sidebar ordering | `Chat.updatedAt`, bumped each turn |

`GET /api/chats/:id` re-hydrates `reasoning` and `code` from `meta`, so a
refreshed page shows the same Reasoning / Code panels with no live stream.

---

## Event reference

Defined once in `api/src/types.ts` and mirrored in `frontend/src/types.ts`.

| Event | Payload | Emitted when | Frontend effect |
|---|---|---|---|
| `message` | `{ message }` | user msg persisted; each assistant msg persisted | append to `messages`; on assistant, end the live turn |
| `chat:title` | `{ title }` | first user message in a chat | rename in the sidebar |
| `reasoning` | `{ text }` | each thinking delta | `reasoning += text` |
| `token` | `{ text }` | each **prose** delta | `streamingText += text` |
| `code` | `{ text, replace? }` | tool-call arg fragments; `replace:true` with the parsed program | `replace` ? set : append `streamingCode` |
| `build:start` / `build:progress` / `build:done` / `build:error` | see types | around a `createSlides` call | status line, `building` flag, `setDeck` |
| `error` | `{ error }` | unexpected exception | status line |
| `done` | — | stream closing (always last) | clear buffers, re-enable input, refresh sidebar |
