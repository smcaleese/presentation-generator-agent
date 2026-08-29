# Daytona workflow — PPTX generation

How a chat message becomes rendered slides.

## Split of responsibilities

| Concern | Where | Notes |
|---|---|---|
| Decide whether to build; write / edit `python-pptx`; summarise | DeepSeek agent loop (`runTurn` + `streamAgentStep`) | `createSlides` tool, `tool_choice: "auto"` |
| **Run** the tool's code → `deck.pptx` | **Daytona sandbox** (`runBuildInSandbox`) | generic Python image; `python-pptx` installed at runtime; untrusted code stays isolated |
| `deck.pptx` → `deck.pdf` → per-slide `.png` | **API process** (`pptxToSlides`) | fat image ships LibreOffice + poppler; plain `child_process` |
| Store + serve the images | API — `STORAGE_DIR` + `GET /api/files/*` | |
| Display | `SlideViewer` carousel | driven by `build:*` SSE events |

The sandbox is created **lazily** on the first build in a chat and **reused** for
later edits via `Chat.sandboxId` — the previous `deck.pptx` is still in its
working directory, so edits are incremental.

---

## Flow — the agent loop (`api/src/pipeline.ts` `runTurn`)

```
frontend                 api                              Daytona sandbox
────────                 ───                              ───────────────
send message ─POST──▶ build Responses `input[]` from DB
                     (assistant turns replay their stored `reasoning` items)
                          │
                     ┌── loop (≤ MAX_STEPS) ─────────────────────────────┐
                     │  streamAgentStep(input):  DeepSeek Responses API   │
   ◀─ reasoning ─────┤    response.reasoning_text.delta                   │
   ◀─ token (prose) ─┤    response.output_text.delta                      │
   ◀─ code ──────────┤    response.function_call_arguments.delta          │
                     │    response.completed → output items               │
                     │                                                   │
                     │  no function_call ─▶ persist assistant Message    │
                     │                     (+ reasoning items), RETURN    │
                     │                                                   │
                     │  createSlides({code}) ─▶ runBuild():              │
   ◀─ code {replace} ┤    (snap Code panel to the clean parsed code)     │
   ◀─ build:start ───┤    DeckVersion → "building"                       │
   ◀─ build:progress ┤    runBuildInSandbox(code, chat.sandboxId) ──────▶ create/get, pip, run, download .pptx
   ◀─ build:progress ┤    pptxToSlides(pptxBytes)          [API host]    │
   ◀─ build:done ────┤    write files, DeckVersion → "ready" + Slides    │
                     │    input.push(...outputItems,                    │
                     │      {function_call_output, call_id, output})     │
                     │    LOOP AGAIN                                     │
                     └───────────────────────────────────────────────────┘
   ◀─ message  "<the model's own summary>"
   ◀─ done
   setDeck(deck) → <SlideViewer> renders <img src="/api/files/…">
```

- **Greetings / questions** → the model returns prose, no tool call → one
  `message`, no build.
- **Build fails** → `DeckVersion.status = "error"`, a `build:error` event, and the
  **tool result carries the Python error back to the model**, which reads it and
  calls `createSlides` again (within `MAX_STEPS`).
- `runTurn` never throws; the safety net after the loop persists a "couldn't
  build after several attempts" message.

---

## Sandbox details (`api/src/daytona.ts`)

- **Client** is created lazily so the app boots without `DAYTONA_API_KEY`.
- **`getOrCreateSandbox(id?)`** — `daytona.get(id)` (reuse), falling back to
  `daytona.create({ language: "python", autoStopInterval: 15, autoDeleteInterval: 60 })`
  (minutes). Idle sandboxes stop after 15 min and are deleted 60 min later.
- **`runBuildInSandbox(code, id?)`**:
  1. `python -c 'import pptx' || pip install -q python-pptx || pip install -q --break-system-packages python-pptx`
     — idempotent; ~instant on a warm sandbox
  2. `fs.uploadFile(Buffer, "build.py")`
  3. `process.executeCommand("python build.py", …, timeout 120s)` — non-zero exit
     ⇒ throw with the combined stdout/stderr (`ExecuteResponse.result`)
  4. `fs.downloadFile("deck.pptx")` → `Buffer`
  5. return `{ pptxBytes, sandboxId }`
- **`deleteSandbox(id)`** — called from `DELETE /api/chats/:id`.

Measured: cold build ~3–4 s (create + install + run + download), warm reuse ~1 s.

## The model call (`api/src/llm.ts` `streamAgentStep`)

- **DeepSeek Responses API**, streaming (`llm.responses.create({ input, tools,
  reasoning: { effort }, stream: true })`).
- `instructions` carries the system prompt; `input` is an array of items
  (`{role, content}` messages, `function_call`, `function_call_output`,
  `reasoning`).
- `reasoning: { effort }` — `"low" | "high" | "max"` (env `REASONING_EFFORT`);
  omitted when `off`.
- `tools: [{ type: "function", name: "createSlides", parameters: {...} }]`,
  `tool_choice: "auto"`. One parameter: `code`.
- Streamed events consumed: `response.reasoning_text.delta` → `reasoning`,
  `response.output_text.delta` → `token` (prose), `response.function_call_arguments.delta`
  → `code`, `response.completed` → the authoritative `output` item list.
- **Statelessness + tools:** DeepSeek has no `previous_response_id`; the full
  `input` is resent each step, and the model's **`reasoning` output items must be
  replayed** (in-loop *and* across user turns) or the request 400s. `runTurn`
  keeps the last step's `outputItems`, stores the `reasoning` ones in
  `Message.meta.reasoningItems`, and prepends them when rebuilding history.
- Once the `createSlides` args parse, a `code {replace:true}` event snaps the
  Code panel from the raw JSON fragments to the clean program.

## Render details (`api/src/render.ts`)

- `pptxToSlides(pptx)` writes to a temp dir, then:
  - `soffice --headless -env:UserInstallation=file://<tmp>/lo-profile --convert-to pdf --outdir <tmp> deck.pptx`
    — per-call profile dir so concurrent conversions don't fight the single-instance lock
  - `pdftoppm -png -r 150 <tmp>/deck.pdf <tmp>/slide` → `slide-1.png …`
  - reads PNGs back in **numeric** order (handles `slide-1` … `slide-10` and the
    zero-padded `slide-01` form)
  - temp dir always cleaned up
- `soffice` resolution: `SOFFICE_BIN` env → `/Applications/LibreOffice.app/…` →
  `soffice` on PATH. The Docker image installs `libreoffice-impress` +
  `poppler-utils` + fonts.

---

## Optional improvements

| Item | Benefit |
|---|---|
| Custom Daytona **snapshot** with `python-pptx` baked in | drops the runtime `pip install` from the first build |
| Kick off `getOrCreateSandbox` before the first `streamAgentStep` | hides sandbox-create latency |
| Warm `soffice` once on API boot | first real conversion isn't the slow one (~3–5 s) |
| PDF download button in `SlideViewer` | `deck.pdf` is already stored + served |
| Persist per-step tool messages | full agent transcript survives reload (today it's one collapsed `Message`/turn) |
