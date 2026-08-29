# Implementation plan — Daytona deck-build flow

> **Status: implemented, then evolved.** Phases 0–5 shipped, then the turn was
> reworked into an **agent loop** (a `createSlides` tool the model chooses to
> call) on **DeepSeek's Responses API**. This file is the original plan, kept as a
> record — `runDeckBuild` / `generateBuildCode` below are now `runTurn` /
> `streamAgentStep`. For the current design see
> [DAYTONA_WORKFLOW.md](DAYTONA_WORKFLOW.md).

Turn the scaffolded deck path into a working feature: **describe a deck in chat →
agent writes `python-pptx` → runs it in a Daytona sandbox → API converts to
PDF/PNG → slides render in the preview pane.**

## Architecture (decided)

| Concern | Where | Why |
|---|---|---|
| Run the model's generated Python | **Daytona sandbox** (generic Python image) | untrusted code stays isolated; sandbox only needs `pip install python-pptx` at runtime |
| `.pptx` → `.pdf` → per-slide `.png` | **`api` process** (fat Docker image w/ LibreOffice + poppler) | one place, plain `child_process`, no shelling into the sandbox |
| Store + serve slide images | `api` — `STORAGE_DIR` + `GET /api/files/*` | already built |
| Display | `SlideViewer` carousel | already built |

Sandbox is created **lazily** on the first deck build in a chat, then reused for
later edits via `Chat.sandboxId`.

---

## Phase 0 — Prep

- [ ] **Confirm the `@daytona/sdk` API.** Read `node_modules/@daytona/sdk` types.
      Write down the real calls for: create sandbox, get sandbox by id, exec a
      command (with stdout/stderr/exit), upload a file, download a file. The
      current `api/src/daytona.ts` uses guessed names.
- [ ] **Decide the trigger.** Recommended: add `mode: "chat" | "deck"` to the
      send-message request, with a UI toggle. Keeps the chatbot; `"deck"` routes
      to `runDeckBuild`. (Alt: a dedicated `POST /api/chats/:id/deck`.)

---

## Phase 1 — API-side conversion (no Daytona yet)

**New file `api/src/render.ts`:**

```ts
export async function pptxToSlides(pptx: Buffer): Promise<{
  pdfBytes: Buffer;
  slidePngs: Buffer[];   // ordered
}>;
```

- write `pptx` to a fresh temp dir
- `soffice --headless --convert-to pdf --outdir <tmp> deck.pptx`
  - give each call its own profile: `-env:UserInstallation=file:///tmp/lo-<rand>`
    (LibreOffice single-instance lock)
  - wrap in a timeout (~60 s) and kill the process group on timeout
- `pdftoppm -png -r 150 <tmp>/deck.pdf <tmp>/slide` → `slide-1.png …`
- read PNGs back in numeric order (not lexical — `slide-2` before `slide-10`)
- read `deck.pdf`
- always clean up the temp dir

**`api/Dockerfile`:** add
`apt-get install -y --no-install-recommends libreoffice-impress poppler-utils fonts-liberation fonts-dejavu`.
Local dev: `brew install libreoffice poppler`.

**Test:** unit test `pptxToSlides` against a small committed `.pptx` fixture
(generate it once with a throwaway `python-pptx` script).
**Milestone:** a `.pptx` in → correctly ordered PNG buffers out.

---

## Phase 2 — Sandbox execution

**Replace `buildAndRender` in `api/src/daytona.ts`:**

```ts
export async function runBuildInSandbox(
  buildCode: string,
  sandboxId?: string,
): Promise<{ pptxBytes: Buffer; sandboxId: string }>;
```

1. `getOrCreateSandbox(sandboxId)` — generic `language: "python"` image
2. ensure the lib: `exec("python -c 'import pptx' 2>/dev/null || pip install python-pptx")`
3. upload `buildCode` to `/workspace/build.py`
4. `exec("cd /workspace && python build.py")` — capture stdout/stderr/exit;
   **non-zero exit → throw** with stderr as the message
5. download `/workspace/deck.pptx` → `Buffer`
6. return `{ pptxBytes, sandboxId: sandbox.id }`

**Test:** a script that calls `runBuildInSandbox` with a hardcoded `python-pptx`
program (no LLM), then runs `pptxToSlides` on the result.
**Milestone:** prompt-free `python → pptx → png` end to end.

---

## Phase 3 — Orchestration

**`api/src/pipeline.ts` `runDeckBuild`** (consider splitting this file into
`chat.ts` / `deck.ts` while here):

1. `generateBuildCode(prompt, prior?.buildCode, { onReasoning, onContent })` — exists
2. create `DeckVersion` `status: "building"` with the code
3. `emit build:progress "starting sandbox"` → `runBuildInSandbox(code, chat.sandboxId)`
4. **persist `chat.sandboxId`** (currently commented out) so edits reuse it
5. `emit build:progress "converting"` → `pptxToSlides(pptxBytes)`
6. write `deck.pdf` + `slide-*.png` to `STORAGE_DIR/<chatId>/<version>/`
7. update `DeckVersion` → `status: "ready"`, `pdfPath`, create `Slide` rows
8. `emit build:done` with `toDeckDto(deck)`
9. `catch` → `DeckVersion.status = "error"`, `error = message`, `emit build:error`

**Test:** call `runDeckBuild` directly with a prompt; assert a `ready`
`DeckVersion` + files on disk.
**Milestone:** prompt in → ready deck out, no HTTP/UI.

---

## Phase 4 — API wiring

**`api/src/routes.ts` — `POST /api/chats/:id/messages`:**

- accept `{ content, mode?: "chat" | "deck" }`
- persist the user message + auto-title (shared, unchanged)
- `mode === "deck"` → `await runDeckBuild(id, content, emit)`
  else → `await runChatTurn(id, emit)`
- `DELETE /api/chats/:id` → also `daytona.delete(chat.sandboxId)` if set

**Milestone:** `curl` with `"mode":"deck"` → observe `build:*` SSE events, then
`GET /api/chats/:id` shows `latestDeck` with slide URLs that load.

---

## Phase 5 — Frontend

- **`api.ts`** — `sendMessage(chatId, content, mode, onEvent)`
- **`App.tsx` `handleSend`** — pass `mode`; handle events:
  - `build:start` / `build:progress` → `setStatus(step)`, `setBuilding(true)`
  - `build:done` → `setDeck(e.deck)`, `setBuilding(false)`
  - `build:error` → `setStatus("Build failed: …")`, `setBuilding(false)`
- **`ChatPane`** — a `Chat / Slides` toggle by the composer (segmented control)
- **`SlideViewer`** — pass the real `building` flag (currently hardcoded `false`);
  show the current progress step while building
- **`App.tsx`** already seeds `deck` from `getChat().latestDeck` on load — keep

**Milestone:** in "Slides" mode, type a prompt → reasoning + code stream → slides
appear in the preview → a follow-up edit produces v2 in the same sandbox.

---

## Phase 6 — Polish

- **Sandbox lifecycle:** auto-stop interval on `create`; delete on chat delete.
- **Latency:** start `getOrCreateSandbox` in parallel with `generateBuildCode`.
- **PDF download:** button in `SlideViewer` → the already-served `deck.pdf`.
- **LibreOffice warm-up:** one throwaway conversion on `api` boot (~3–5 s once).
- **Retry UX:** on `build:error`, show stderr in the chat; next turn already
  feeds the prior `buildCode` back to the model.
- **Incremental edits:** verify the model *opens* `/workspace/deck.pptx` in the
  warm sandbox rather than rebuilding; tune the build system prompt if not.

---

## Risks / unknowns

| Risk | Mitigation |
|---|---|
| `@daytona/sdk` method names are guessed | Phase 0 — verify against installed types first |
| LibreOffice concurrency / zombie `soffice` | per-call `-env:UserInstallation`, timeout + kill process group |
| First `soffice` call is slow (~3–5 s cold) | acceptable; optional boot warm-up |
| Cold sandbox + `pip install` on first build (~15–30 s) | surface via `build:progress`; amortized by sandbox reuse |
| Font substitution changes layout | install `fonts-liberation` / `fonts-dejavu` in the `api` image |
| `pdftoppm` output ordering | read `slide-N.png` by parsed integer, not lexically |
| Very large decks | cap slide count / dpi; stream slide URLs as they're written |

---

## Suggested order & rough effort

| Phase | Effort |
|---|---|
| 0 — prep / SDK check | 0.5–1 h |
| 1 — `render.ts` + Dockerfile | 2–3 h |
| 2 — `runBuildInSandbox` | 3–4 h (SDK learning curve) |
| 3 — orchestration | 1–2 h |
| 4 — route wiring | 1 h |
| 5 — frontend | 2–3 h |
| 6 — polish | as time allows |

Phases 1 and 2 are independent and can be built/tested in parallel; phase 3
joins them.
