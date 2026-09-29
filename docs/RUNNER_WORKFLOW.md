# Runner workflow — PPTX generation

How a chat message becomes rendered slides.

## Split of responsibilities

| Concern | Where | Notes |
|---|---|---|
| Decide whether to build; write / edit `python-pptx`; summarise | DeepSeek agent loop (`runTurn` + `streamAgentStep`) | `createSlides` tool, `tool_choice: "auto"` |
| **Run** the tool's code → `deck.pptx` | **`runner` service** (`postBuild` in `api/src/runner.ts`) | Python image with `python-pptx` pre-installed; no secrets, internal-only network; untrusted code stays isolated |
| `deck.pptx` → `deck.pdf` → per-slide `.png` | **API process** (`pptxToSlides`) | fat image ships LibreOffice + poppler; plain `child_process` |
| Store + serve the images | API — `STORAGE_DIR` + `GET /api/chats/:chatId/decks/:version/{deck.pptx,deck.pdf,slides/N.png}` | |
| Display | `SlideViewer` carousel | driven by `build:*` SSE events |

The runner is **stateless**: every `createSlides` call sends the model's *complete* program, which
is run in a throwaway directory and discarded. Edits work because the previous program is in the
model's context, not because a working directory persists.

---

## Flow — the agent loop (`api/src/pipeline.ts` `runTurn`)

```
frontend                 api                              runner service
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
   ◀─ build:progress ┤    postBuild(chatId,msgId,code) ────────────────▶ /tmp/builds/<chat>/<msg>/, python build.py, return .pptx
   ◀─ build:progress ┤    pptxToSlides(pptxBytes)          [API host]    │
   ◀─ build:done ────┤    write files, DeckVersion → "ready" + Slides    │
                     │    input.push(...outputItems,                    │
                     │      {function_call_output, call_id, output})     │
                     │    LOOP AGAIN                                     │
                     └───────────────────────────────────────────────────┘
   ◀─ message  "<the model's own summary>"
   ◀─ done
   setDeck(deck) → <SlideViewer> renders <img src="/api/chats/<id>/decks/<v>/slides/N.png">
```

- **Greetings / questions** → the model returns prose, no tool call → one
  `message`, no build.
- **Build fails** → `DeckVersion.status = "error"`, a `build:error` event, and the
  **tool result carries the Python error back to the model**, which reads it and
  calls `createSlides` again (within `MAX_STEPS`).
- `runTurn` never throws; the safety net after the loop persists a "couldn't
  build after several attempts" message.

---

## Runner details

**API side (`api/src/runner.ts`)**
- `postBuild(chatId, messageId, code)` runs inside a `p-limit(MAX_CONCURRENT_BUILDS)` slot and POSTs `{code}` to
  `RUNNER_URL/build` (bearer `RUNNER_TOKEN`, 90 s abort). `isBusy()` lets the pipeline emit
  "waiting for a free build slot".
- `200` → `.pptx` bytes. `422` → `BuildError` with the program's output (fed back to the model).
  `429`/`409`/`503`/network errors are retried with backoff, then thrown as a plain `Error`.
- `checkRunner()` runs at boot (`index.ts`); stale `building` DeckVersions are failed on boot too.

**Runner side (`runner/app.py`)**
- `POST /build {chat_id, message_id, code}`: writes `build.py` into
  `/tmp/builds/<chat_id>/<message_id>/` (real directories on the container's RAM-backed `/tmp`
  tmpfs; `message_id` is the user message that triggered the turn). `mkdir` is the lock — a second
  build for the same message gets `409`. Ids are validated against `^[A-Za-z0-9_-]{1,64}$` (`400`
  otherwise). The message dir is deleted when the build ends (success, failure or timeout), then the
  chat dir if empty; `/tmp/builds` is wiped on runner startup. Runs `python build.py` with a scrubbed
  environment (`PATH`, `HOME` only), `RLIMIT_CPU/AS/FSIZE/NPROC`, a 60 s wall-clock timeout, and
  its own process group (SIGKILL on timeout). Returns `deck.pptx`, or `422 {output}`.
- Its own cap (`MAX_CONCURRENT`) returns `429` when full. `GET /health` for the compose healthcheck.
- Compose hardening: `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit`,
  `pids_limit`, and an `internal: true` network — no route to the db or the internet.

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
| Move LibreOffice/poppler into the runner | API becomes a plain Node image |
| bubblewrap/nsjail or a fresh container per build | stronger isolation for untrusted public users |
| Warm `soffice` once on API boot | first real conversion isn't the slow one (~3–5 s) |
| PDF download button in `SlideViewer` | `deck.pdf` is already stored + served |
| Persist per-step tool messages | full agent transcript survives reload (today it's one collapsed `Message`/turn) |

## Where files live

| Where | Path | Lifetime |
|---|---|---|
| runner (tmpfs) | `/tmp/builds/<chatId>/<messageId>/{build.py,deck.pptx}` | seconds — deleted when the build ends |
| api (tmp) | `/tmp/deck-xxxx/` (LibreOffice profile, pdf, pngs) | seconds — deleted after render |
| api (`STORAGE_DIR` volume) | `<chatId>/<version>/{deck.pptx,deck.pdf,slide-N.png}` | until the chat is deleted (`DELETE /api/chats/:id` removes `<chatId>/`) |

One user message can trigger several builds (the model retries after an error, up to `MAX_STEPS`);
they run sequentially, so they safely reuse the same `<messageId>` directory.
