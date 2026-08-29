# presentation-generator-agent

The conversational core of a presentation-generator agent. **Right now** it's a
DeepSeek reasoning chatbot: a chat UI where each reply streams the model's
thinking into a collapsible panel above the answer, with per-chat history in
Postgres.

Where it's headed — describing a deck in chat and having an agent build it — is in
[IDEA.md](IDEA.md) and [PLAN.md](PLAN.md).

## Layout

```
frontend/   React 19 + Vite 6 + TS + Tailwind 4 + shadcn/ui  — sidebar + chat pane
api/        Fastify 5 + Prisma 6 + TS                          — chats API, LLM streaming (SSE)
docker-compose.yml                                             — postgres + api + frontend
.env                                                           — single env file, read by the api
```

`frontend/src/types.ts` and `api/src/types.ts` are a hand-maintained shared
contract — keep them in sync. See [REVIEW.md](REVIEW.md) for a walkthrough of the
message flow from frontend to backend.

---

## Running locally

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 | `node --version` |
| npm | ≥ 10 | ships with Node |
| Docker + Compose | any recent | only used to run Postgres locally |

### 1. Environment file

One `.env` at the repo root:

```bash
cp .env.example .env
```

Then set the one required value:

| Variable | Required for | Default |
|---|---|---|
| `DEEPSEEK_API_KEY` | the chat model | *(blank — add yours)* |
| `DEEPSEEK_BASE_URL` | — | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | — | `deepseek-v4-flash` (a reasoning model; its thinking trace streams to the chat pane) |
| `REASONING_EFFORT` | — | `medium` — `low` / `medium` / `high`; `off` disables the thinking toggle |
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
npm install
npm run prisma:migrate -- --name init   # first run only — creates tables
npm run dev
```

- http://localhost:3001, hot reload via `tsx watch`.
- Verify: `curl localhost:3001/api/health` → `{"ok":true}`
- The `.env` lives at the repo root; the Prisma CLI doesn't auto-load it, so use
  the `prisma:*` npm scripts (they wrap the CLI with `dotenv -e ../.env`). Running
  `npx prisma …` directly fails with `Environment variable not found: DATABASE_URL`.

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

http://localhost:5173. Vite proxies `/api/*` to `http://localhost:3001`, so there's
no CORS setup in dev.

### 5. Use it

A chat is created automatically. **New chat** (top-left) makes more; the first
message names the chat. Type anything — the model's reasoning streams into a
collapsible panel above each answer, and the whole conversation is saved per chat.

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
| API dev server | `cd api && npm run dev` |
| Frontend dev server | `cd frontend && npm run dev` |
| Apply a schema change | `cd api && npm run prisma:migrate -- --name <change>` |
| Inspect the DB | `cd api && npm run prisma:studio` |
| Type-check API | `cd api && npx tsc --noEmit` |
| Build frontend | `cd frontend && npm run build` |
| Reset the local DB | `docker compose down -v && docker compose up -d db && cd api && npm run prisma:migrate` |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required env var: DATABASE_URL` | `.env` missing or not at repo root — `cp .env.example .env` |
| `Environment variable not found: DATABASE_URL` from a `prisma` command | you ran `npx prisma …` directly — use the `prisma:*` npm scripts |
| `[tsx] Previous process hasn't exited yet` | stale dev server — `pkill -f "tsx watch"` |
| API exits with a Postgres connection error | `docker compose up -d db` and wait a few seconds |
| Chat replies with `Error: 401` | `DEEPSEEK_API_KEY` missing or invalid in the root `.env` |
| Port 3001 / 5173 / 5432 already in use | stop the other process, or change `PORT` / the compose port mappings |
