# presentation-generator-agent

Describe a presentation in chat. The model decides whether to call a
**`createSlides` tool** — if it does, its `python-pptx` code runs in the
**runner service** (an isolated container) to produce a `.pptx`, the API renders that to per-slide PNGs shown in a
live preview, and the tool's result (slide count, or the Python error) goes back
to the model so it can fix mistakes and try again. Plain questions / greetings
get a normal reply with no build. Each successful build is a new version.

The reasoning and the tool's code stream into the chat as collapsible panels.
Background: [docs/IDEA.md](docs/IDEA.md), [docs/PLAN.md](docs/PLAN.md). Flow
walkthroughs: [docs/REVIEW.md](docs/REVIEW.md) (message → SSE),
[docs/RUNNER_WORKFLOW.md](docs/RUNNER_WORKFLOW.md) (tool → runner → render).

## Layout

```
frontend/   React 19 + Vite 6 + TS + Tailwind 4 + shadcn/ui  — collapsible sidebar (rename/delete) + chat + slide preview; light/dark
                                                               (visual reference: docs/design-mockup.html)
api/        Fastify 5 + Prisma 6 + TS                          — chats API, LLM streaming (SSE), deck build + render
runner/     FastAPI + python-pptx                              — isolated service that runs the model's build programs
docker-compose.yml                                             — postgres + api + runner + frontend
.env                                                           — single env file, read by the api
```

`frontend/src/types.ts` and `api/src/types.ts` are a hand-maintained shared
contract — keep them in sync.

The **API host renders `.pptx → .pdf → .png`** with LibreOffice + poppler (baked
into `api/Dockerfile`). For local dev outside Docker: `brew install libreoffice
poppler` (or set `SOFFICE_BIN`). The model's code runs in the **`runner`** container
(`python-pptx` pre-installed, no secrets, internal-only network). To run the API on the host,
start just the runner with `docker compose -f docker-compose.yml -f docker-compose.dev-runner.yml up -d runner`
and set `RUNNER_URL=http://localhost:8000` in `.env` (see `.env.example`).

---

## Running locally

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 | `node --version` |
| pnpm | ≥ 10 | `corepack enable` (version pinned via `packageManager`) |
| Docker + Compose | any recent | runs Postgres (and the whole stack if you want) |
| LibreOffice + poppler | any recent | **only for non-Docker local dev** — `brew install libreoffice poppler`. Baked into `api/Dockerfile` otherwise. |

### 1. Environment file

One `.env` at the repo root:

```bash
cp .env.example .env
```

Then set the required values:

| Variable | Required for | Default |
|---|---|---|
| `DEEPSEEK_API_KEY` | writing the `python-pptx` code | *(blank — add yours)* |
| `RUNNER_URL` | where the api reaches the runner (compose sets it to `http://runner:8000`) | `http://localhost:8000` for host dev |
| `RUNNER_TOKEN` | shared secret between api and runner | `dev-runner-token` |
| `STORAGE_DIR` | where generated `.pptx` / `.pdf` / slide PNGs are written | `./storage` |
| `DEEPSEEK_BASE_URL` | — | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | — | `deepseek-v4-flash` (a reasoning model; its thinking trace streams to the chat pane) |
| `REASONING_EFFORT` | — | `medium` — `low` / `medium` / `high` / `max` (DeepSeek has no true medium; it maps to `high`); `off` disables thinking |
| `DATABASE_URL` | api ↔ Postgres | points at `localhost:5432` |
| `PORT` | api listen port | `3001` |

The app boots without `DEEPSEEK_API_KEY`; the first chat message just fails at the
LLM call until it's set.

### 2. Start Postgres

```bash
docker compose up -d db
```

`postgres:17-alpine` on `localhost:5432` (`postgres` / `postgres` / `presentations`),
data in the `db_data` volume.

### 3. Start the API

```bash
cd api
pnpm install
pnpm run prisma:migrate --name init   # first run only — creates tables
pnpm run dev
```

- http://localhost:3001, hot reload via `tsx watch`.
- Verify: `curl localhost:3001/api/health` → `{"ok":true}`
- The `.env` lives at the repo root; the Prisma CLI doesn't auto-load it, so use
  the `prisma:*` pnpm scripts (they wrap the CLI with `dotenv -e ../.env`). Running
  `pnpm exec prisma …` directly fails with `Environment variable not found: DATABASE_URL`.

### 4. Start the frontend

```bash
cd frontend
pnpm install
pnpm run dev
```

http://localhost:5173. Vite proxies `/api/*` to `http://localhost:3001`, so there's
no CORS setup in dev.

### 5. Use it

A chat is created automatically (**New chat**, top-left, makes more). Describe a
deck — *"A 6-slide intro to vector databases for engineers."* — and the model
calls `createSlides`: **Reasoning** and **Code** panels stream in, the status line
shows `running build → rendering slides`, then the slides appear in the
preview and the model writes a short summary. Refine with follow-ups
(*"make slide 3 a bar chart"*) — each is a new version (the model re-sends the full updated program).
Say *"hi"* and it just replies — no build.

Builds take a couple of seconds plus render time (no sandbox cold start). If the model's code errors, the error is fed back
and it retries automatically.

The sidebar collapses to an icon rail (each chat has a **⋯** menu with Rename / Delete), and the
chat and preview panes scroll independently with a draggable divider (sizes and the sidebar state
persist per browser). Each reply that built a deck shows a **Deck vN** box — click one to view that
version. The preview header has the **PPTX** and **PDF** download buttons; the footer has
Previous / Next (or use ← →). A light/dark toggle is at the bottom of the sidebar.

---

## Running everything in Docker

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| frontend | http://localhost:5173 |
| api | http://localhost:3001 (runs `prisma migrate deploy` on start) |
| db | localhost:5432 |

`docker compose down` stops everything; add `-v` to also wipe the database.

---

## Common commands

| Task | Command |
|---|---|
| API dev server | `cd api && pnpm run dev` |
| Frontend dev server | `cd frontend && pnpm run dev` |
| Apply a schema change | `cd api && pnpm run prisma:migrate --name <change>` |
| Inspect the DB | `cd api && pnpm run prisma:studio` |
| Type-check API | `cd api && npx tsc --noEmit` |
| Build frontend | `cd frontend && pnpm run build` |
| Reset the local DB | `docker compose down -v && docker compose up -d db && cd api && pnpm run prisma:migrate` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required env var: DATABASE_URL` | `.env` missing or not at repo root — `cp .env.example .env` |
| `Environment variable not found: DATABASE_URL` from a `prisma` command | you ran `pnpm exec prisma …` directly — use the `prisma:*` pnpm scripts |
| `[tsx] Previous process hasn't exited yet` | stale dev server — `pkill -f "tsx watch"` |
| API exits with a Postgres connection error | `docker compose up -d db` and wait a few seconds |
| Chat replies with `Error: 401` | `DEEPSEEK_API_KEY` missing or invalid in the root `.env` |
| `Build failed: … spawn soffice ENOENT` | LibreOffice not on PATH — `brew install libreoffice poppler`, or run via Docker, or set `SOFFICE_BIN` |
| `Build failed: runner unreachable` | the `runner` container isn't up — `docker compose up -d runner`; for host dev see the runner note above |
| Port 3001 / 5173 / 5432 already in use | stop the other process, or change `PORT` / the compose port mappings |

---

## Status

| Piece | State |
|---|---|
| Agent loop (`runTurn`) — `createSlides` tool, `tool_choice: "auto"`, retry-on-error | ✅ |
| DeepSeek **Responses API** — streaming, thinking, tools; `reasoning` items replayed (stateless + tools) | ✅ |
| `postBuild` (`api/src/runner.ts`) — POST the program to the stateless `runner` service, get the `.pptx` back; `p-limit` caps concurrent builds | ✅ |
| `pptxToSlides` — `soffice` → PDF, `pdftoppm` → per-slide PNG (on the API host) | ✅ |
| `DeckVersion` / `Slide` + `/api/chats/:id/decks/:version/…` file routes; stateless builds (no per-chat sandbox state) | ✅ |
| `SlideViewer` carousel; Reasoning + Code panels + prose bubble in `App.tsx` | ✅ |
| Move LibreOffice/poppler into the runner; per-build isolation (bubblewrap/nsjail) before untrusted public use | ⬜ optional |
| Persisting per-step tool messages (currently one collapsed assistant `Message` per turn) | ⬜ |

See [docs/RUNNER_WORKFLOW.md](docs/RUNNER_WORKFLOW.md) for the full flow.

---

## Docs

| File | What |
|---|---|
| [docs/REVIEW.md](docs/REVIEW.md) | message-send flow, frontend → backend, with code |
| [docs/RUNNER_WORKFLOW.md](docs/RUNNER_WORKFLOW.md) | how the deck build + render works (current design) |
| [docs/BUILD_FLOW.md](docs/BUILD_FLOW.md) | Mermaid flowchart: AI writes code → runner builds it → slides render |
| [docs/example-build.py](docs/example-build.py) | a representative `python-pptx` program the model produces |
| [docs/DAYTONA_PLAN.md](docs/DAYTONA_PLAN.md) | the original Daytona-based plan (superseded by the runner service) |
| [docs/IDEA.md](docs/IDEA.md) | the presentation-generator concept |
| [docs/PLAN.md](docs/PLAN.md) | build plan / tech-stack notes |
