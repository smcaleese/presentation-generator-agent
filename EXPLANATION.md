# How a slide deck gets built: the whole flow

You describe a deck in chat. An AI model writes a Python program, a separate **runner** container
runs it to produce a `.pptx`, the API turns that into slide images, and the browser shows them.
This document walks through every step with the real code.

For a one-page picture see [docs/BUILD_FLOW.md](docs/BUILD_FLOW.md). For setup see the [README](README.md).

## Contents

1. [The pieces](#1-the-pieces)
2. [Step by step](#2-step-by-step)
3. [Where files live](#3-where-files-live)
4. [Isolation and safety](#4-isolation-and-safety)
5. [Concurrency and limits](#5-concurrency-and-limits)
6. [Errors and retries](#6-errors-and-retries)
7. [Configuration](#7-configuration)
8. [Known limitations](#8-known-limitations)

---

## 1. The pieces

```
Browser ──SSE──▶ API (Fastify) ──HTTP POST /build──▶ Runner (FastAPI)
                  │  │  │                              runs python build.py
                  │  │  └─▶ DeepSeek (the AI)          no secrets, no network
                  │  └────▶ LibreOffice + poppler      (pptx → pdf → png)
                  └───────▶ Postgres + storage volume
```

| Piece | Where | Job |
|---|---|---|
| **Frontend** | `frontend/` | Chat UI and slide preview. Reads the SSE stream. |
| **API** | `api/` | Talks to the AI, calls the runner, renders slides, stores everything. |
| **AI** | DeepSeek, called from `api/src/llm.ts` | Decides whether to build, and writes the Python program. |
| **Runner** | `runner/` | Runs the AI's program in isolation and returns `deck.pptx`. |
| **Renderer** | LibreOffice + poppler, inside the API container | Turns the pptx into per-slide PNGs. |
| **Postgres** | `db` service | Chats, messages, deck versions, slide records. |

The runner is deliberately separate: the AI's code is **untrusted**, so it must not run next to the
API's secrets (DeepSeek key, database credentials).

---

## 2. Step by step

### Step 1: the user sends a message

`POST /api/chats/:id/messages` ([routes.ts](api/src/routes.ts)) opens a Server-Sent Events stream, saves the
user's message, then hands over to `runTurn`. The **user message's ID** matters later: it names the
runner's working directory.

```ts
const userMsg = await prisma.message.create({
  data: { chatId: id, role: "user", content },
});
emit({ type: "message", message: { id: userMsg.id, role: "user", content: userMsg.content, /* … */ } });

try {
  await runTurn(id, userMsg.id, content, emit);   // the agent loop
} catch (err) {
  emit({ type: "error", error: err instanceof Error ? err.message : String(err) });
} finally {
  emit({ type: "done" });
  reply.raw.end();
}
```

`emit` writes one SSE event to the browser. Everything the user sees live (reasoning, code,
build progress, slides) is an event sent through it.

### Step 2: the AI is offered one tool

In [llm.ts](api/src/llm.ts) the model is told to call a `createSlides` tool with a **complete** Python
program whenever the user wants slides, and to reply in plain text otherwise.

```ts
const createSlidesTool: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: "createSlides",
  description: "Build or revise the slide deck by running a python-pptx program that writes deck.pptx.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          'A complete Python program using python-pptx that saves the presentation as "deck.pptx" in the current directory. Do not touch any other path.',
      },
    },
    required: ["code"],
  },
};
```

For an edit ("make slide 3 a bar chart"), `runTurn` puts the previous program into the model's input, so the
model returns a full updated program. **Nothing else remembers the old deck**, which is why the runner
can be stateless.

### Step 3: the agent loop

`runTurn` ([pipeline.ts](api/src/pipeline.ts)) loops up to `MAX_STEPS = 5` model calls. Each call streams
reasoning, text and code to the browser as it arrives.

```ts
for (let step = 0; step < MAX_STEPS; step++) {
  const { text, outputItems, functionCalls } = await streamAgentStep(input, {
    onReasoning: (t) => emit({ type: "reasoning", text: t }),
    onText: (t) => emit({ type: "token", text: t }),
    onCode: (t) => emit({ type: "code", text: t }),
  });

  if (functionCalls.length === 0) {          // greeting or question: just reply
    await persist(text.trim() || "Done.");
    return;
  }

  input.push(...outputItems);                // replay the model's own output
  for (const call of functionCalls) {
    let toolResult: string;
    if (call.name === "createSlides") {
      const code = parseCode(call.arguments);
      if (code) {
        emit({ type: "code", text: code, replace: true });   // snap the Code panel to the clean program
        toolResult = (await runBuild(chat.id, messageId, code, emit)).toolResult;
      } else {
        toolResult = "Error: createSlides needs a non-empty `code` argument (valid JSON).";
      }
    } else {
      toolResult = `Error: unknown tool "${call.name}".`;
    }
    input.push({ type: "function_call_output", call_id: call.call_id, output: toolResult });
  }
}
```

The `toolResult` string is sent back to the model. On success it says how many slides were built.
On failure it contains the Python error, and the model reads it and calls `createSlides` again
with a fix. That is the retry loop.

### Step 4: `runBuild` orchestrates one build

`runBuild` in [pipeline.ts](api/src/pipeline.ts) does the whole build: record it, run it, render it,
save it. (Not to be confused with `postBuild`, which is just the HTTP call.)

```ts
const version = (prior?.version ?? 0) + 1;
emit({ type: "build:start", version });
const deck = await prisma.deckVersion.create({
  data: { chatId, version, buildCode: code, status: "building" },
});

try {
  emit({ type: "build:progress", step: isBusy() ? "waiting for a free build slot" : "running build" });
  const pptxBytes = await postBuild(chatId, messageId, code);   // → runner

  emit({ type: "build:progress", step: "rendering slides" });
  const { pdfBytes, slidePngs } = await pptxToSlides(pptxBytes);
  /* …save files, mark the DeckVersion ready, emit build:done (see steps 7 and 8)… */
} catch (err) {
  await prisma.deckVersion.update({ where: { id: deck.id }, data: { status: "error", error: message } });
  emit({ type: "build:error", error: message });
  return { ok: false, toolResult: `Error — your program did not produce slides:\n${message}\n\n…` };
}
```

A `DeckVersion` row moves through `building` → `ready` or `error`. If the API is killed mid-build,
a startup sweep in [index.ts](api/src/index.ts) marks leftover `building` rows as `error`.

### Step 5: `postBuild` sends the code to the runner

[runner.ts](api/src/runner.ts) makes the HTTP request. It first waits for a free slot (a `p-limit`
limiter, default 3 at a time), then POSTs the program.

```ts
const slots = pLimit(env.maxConcurrentBuilds);

export function postBuild(chatId: string, messageId: string, code: string): Promise<Buffer> {
  return slots(async () => {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${env.runnerUrl}/build`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${env.runnerToken}` },
          body: JSON.stringify({ chat_id: chatId, message_id: messageId, code }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (err) { /* retry with backoff, then throw "runner unreachable" */ }

      if (res.status === 200) return Buffer.from(await res.arrayBuffer());   // the pptx bytes
      if (res.status === 422) {                                               // the program failed
        const { output } = (await res.json()) as { output: string };
        throw new BuildError(`build.py failed:\n${output}`);
      }
      if ((res.status === 429 || res.status === 409 || res.status === 503) && attempt < 3) {
        await sleep(1000 * (attempt + 1));                                    // runner busy: retry
        continue;
      }
      throw new Error(`runner error (${res.status})`);
    }
  });
}
```

The pptx comes back as **raw binary in the response body** (not JSON or base64), and lands in a Node `Buffer`.

### Step 6: the runner builds it

[runner/app.py](runner/app.py) `POST /build` is where the AI's code actually runs.

**a) Gatekeeping.** Bad token → 401. IDs that aren't `^[A-Za-z0-9_-]{1,64}$` → 400 (they become path
segments, so `../` tricks are rejected). All slots in use → 429.

**b) A directory per message, which is also the lock.**

```python
chat_dir = os.path.join(BUILD_ROOT, req.chat_id)            # /tmp/builds/<chatId>
work = os.path.join(chat_dir, req.message_id)               # /tmp/builds/<chatId>/<messageId>
async with slots:
    os.makedirs(chat_dir, exist_ok=True)
    try:
        os.mkdir(work)          # atomic: fails if this message's build is already running
    except FileExistsError:
        return JSONResponse({"error": "build already running"}, status_code=409)
```

**c) Run the program in a locked-down subprocess.**

```python
with open(os.path.join(work, "build.py"), "w") as f:
    f.write(req.code)
proc = await asyncio.create_subprocess_exec(
    sys.executable, "build.py",
    cwd=work,                                              # so save("deck.pptx") lands here
    env={"PATH": os.environ["PATH"], "HOME": work},        # scrubbed: no secrets
    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    start_new_session=True,                                # own process group
    preexec_fn=_limits,                                    # CPU, memory, file size, process limits
)
```

```python
def _limits() -> None:                                     # runs in the child before exec
    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT_S, TIMEOUT_S))
    resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))          # 1 GiB memory
    resource.setrlimit(resource.RLIMIT_FSIZE, (100 << 20, 100 << 20))   # 100 MiB files
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
```

**d) Wait, then decide.**

```python
try:
    out, _ = await asyncio.wait_for(proc.communicate(), TIMEOUT_S)     # 60 s
except asyncio.TimeoutError:
    try:
        os.killpg(proc.pid, signal.SIGKILL)                            # kill the whole group
    except ProcessLookupError:
        pass                                                           # already dead (CPU limit)
    await proc.wait()
    return JSONResponse({"output": f"build timed out after {TIMEOUT_S}s"}, status_code=422)

text = out.decode(errors="replace")[-OUTPUT_TAIL:]                     # last 8000 chars
deck = os.path.join(work, "deck.pptx")
if proc.returncode != 0 or not os.path.exists(deck):
    return JSONResponse({"output": text or "program exited without writing deck.pptx"}, status_code=422)
with open(deck, "rb") as f:
    return Response(f.read(), media_type="application/octet-stream")   # 200 + the bytes
```

**e) Always clean up.**

```python
finally:
    shutil.rmtree(work, ignore_errors=True)
    try:
        os.rmdir(chat_dir)       # only succeeds if no other build in this chat is running
    except OSError:
        pass
```

Why a subprocess and not a thread or process pool: the code is untrusted, and only a fresh process
can be killed reliably, given its own environment, and bounded by per-build resource limits.

### Step 7: the API renders the slides

Back in the API, `pptxToSlides` ([render.ts](api/src/render.ts)) writes the bytes to a temporary directory
and converts them: LibreOffice makes a PDF, poppler makes one PNG per slide.

```ts
const dir = await mkdtemp(join(tmpdir(), "deck-"));
await writeFile(join(dir, "deck.pptx"), pptx);

// each conversion gets its own LibreOffice profile so parallel runs don't fight over a lock
const profile = `-env:UserInstallation=file://${join(dir, "lo-profile")}`;
await run(sofficeBin(), ["--headless", profile, "--convert-to", "pdf", "--outdir", dir, pptxPath],
  { timeout: 120_000 });
await run("pdftoppm", ["-png", "-r", "150", pdfPath, join(dir, "slide")], { timeout: 120_000 });
/* read slide-1.png … back in numeric order, then rm -rf the temp dir */
```

### Step 8: save, record, tell the browser

Still in `runBuild`: the pptx, PDF and PNGs are written to the **storage volume**, the database rows
are updated, and the browser gets the slides.

```ts
const dir = join(env.storageDir, chatId, String(version));   // storage/<chatId>/<version>/
await writeFile(join(dir, "deck.pptx"), pptxBytes);
await writeFile(join(dir, "deck.pdf"), pdfBytes);
/* …slide-1.png, slide-2.png … */

const ready = await prisma.deckVersion.update({
  where: { id: deck.id },
  data: { status: "ready", pptxPath, pdfPath, slides: { create: slides } },
  include: { slides: { orderBy: { index: "asc" } } },
});
emit({ type: "build:done", deck: toDeckDto(ready) });        // browser shows the slides
// toolResult → "Success: built deck v3 with 8 slides."      // model writes its short summary
```

### Step 9: downloading

The runner is not involved in downloads. The API serves files straight from its own storage volume.
URLs carry ids, never filesystem paths ([files.ts](api/src/files.ts)):

```
/api/chats/<chatId>/decks/3/deck.pptx
/api/chats/<chatId>/decks/3/deck.pdf
/api/chats/<chatId>/decks/3/slides/1.png        (1-based)
```

`toDeckDto` builds them with `deckFileUrl` / `slideImageUrl`, and the frontend renders them as plain links
and `<img>` sources. The route looks the file up in the database, so nothing from the URL is ever used as a path:

```ts
app.get("/api/chats/:chatId/decks/:version/deck.pptx", async (req, reply) => {
  const deck = await prisma.deckVersion.findUnique({
    where: { chatId_version: { chatId, version } },
    select: { pptxPath: true, chat: { select: { title: true } } },
  });
  if (!deck) return reply.code(404).send({ error: "not found" });
  // filename is chosen by the server, e.g. "make-a-3-slide-deck-about-otters-v3.pptx"
  reply.header("Content-Disposition", `attachment; filename="${slug(deck.chat.title)}-v${version}.pptx"`);
  return reply.send(createReadStream(deck.pptxPath));
});
```

---

## 3. Where files live

The pptx is written **three times** over its life, in two different containers that share no filesystem.
The HTTP response in step 5 is the only way it crosses between them.

| # | Location | Backed by | Created by | Lifetime |
|---|---|---|---|---|
| 1 | Runner: `/tmp/builds/<chatId>/<messageId>/deck.pptx` | **RAM** (tmpfs, 512 MB cap) | the AI's `python build.py` | deleted when the build ends |
| 2 | API: `/tmp/deck-xxxx/deck.pptx` | disk (container layer) | `pptxToSlides`, so LibreOffice has a file | deleted after rendering |
| 3 | API: `storage/<chatId>/<version>/deck.pptx` | **disk (named Docker volume)** | `runBuild` | until the chat is deleted |

`DELETE /api/chats/:id` removes the database rows and `storage/<chatId>/`, so old download links then return 404.
One user message can trigger several builds (each retry), but they run one after another, so they safely
reuse the same `<messageId>` directory.

---

## 4. Isolation and safety

The AI's code is treated as untrusted. Defence in depth, from [docker-compose.yml](docker-compose.yml) and `runner/app.py`:

```yaml
runner:
  read_only: true                  # root filesystem is immutable
  tmpfs: [ "/tmp:size=512m" ]      # only /tmp is writable, and it's RAM
  cap_drop: [ALL]
  security_opt: [ "no-new-privileges:true" ]
  mem_limit: 2g
  pids_limit: 256
  networks: [runner-net]           # internal: true, so no route to the db or the internet
```

| Threat | Defence |
|---|---|
| Code reads secrets | scrubbed environment (`PATH` and `HOME` only), and the container holds none |
| Code reaches the database or internet | `runner-net` is `internal: true` (tested: both connections fail) |
| Infinite loop | 60 s wall-clock timeout plus a CPU rlimit, then SIGKILL on the whole process group |
| Memory bomb | 1 GiB address-space rlimit, plus the container's 2 GB cap |
| Disk fill | 100 MiB file-size rlimit, plus the 512 MB tmpfs |
| Fork bomb | process-count rlimit and `pids_limit` |
| Path tricks in IDs | strict ID regex before any path is built |
| Someone else calls the runner | bearer token, and the runner isn't reachable from outside the compose network |

It is not a full sandbox: all builds share one kernel and one container. That's fine for a personal
or internal tool. For untrusted public users you'd add per-build isolation (bubblewrap/nsjail, or a
fresh container per build).

---

## 5. Concurrency and limits

| Where | Limit | When exceeded |
|---|---|---|
| API `p-limit` (`MAX_CONCURRENT_BUILDS`, default 3) | builds in flight per API process | extra builds wait; the UI shows "waiting for a free build slot" |
| Runner semaphore (`MAX_CONCURRENT`, default 3) | builds running at once | `429`, and the API retries with backoff |
| Runner directory lock | one build per message | `409`, and the API retries |
| Runner timeout (`BUILD_TIMEOUT_S`) | 60 s per build | `422` "build timed out" |
| API request timeout | 90 s per HTTP attempt | treated as a network error and retried |
| Agent loop (`MAX_STEPS`) | 5 model steps per user message | "couldn't build after several attempts" |

The runner runs one uvicorn worker on purpose: its directory bookkeeping relies on the event loop not
interleaving its (await-free) critical sections.

---

## 6. Errors and retries

| What happens | Runner says | API does | Model sees |
|---|---|---|---|
| Python exception, non-zero exit, or no `deck.pptx` | `422` + output tail | `BuildError`, DeckVersion → `error`, emit `build:error` | the traceback, so it fixes the code and calls `createSlides` again |
| Timeout | `422` "timed out" | same | "build timed out after 60s" |
| Runner busy | `429` | retry with backoff | nothing yet |
| Same message already building | `409` | retry with backoff | nothing yet |
| Runner unreachable | (no response) | retry twice, then throw | the error text |
| Slide rendering fails | n/a | DeckVersion → `error` | the error text |

---

## 7. Configuration

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `RUNNER_URL` | API | (required) | where the API reaches the runner, `http://runner:8000` in compose |
| `RUNNER_TOKEN` | API + runner | `dev-runner-token` in compose | shared secret |
| `MAX_CONCURRENT_BUILDS` | API | 3 | builds in flight from this API |
| `MAX_CONCURRENT` | runner | 3 | builds the runner runs at once |
| `BUILD_TIMEOUT_S` | runner | 60 | per-build wall-clock and CPU limit |
| `BUILD_ROOT` | runner | `/tmp/builds` | parent of the per-chat directories |
| `STORAGE_DIR` | API | `./storage` (`/app/storage` in compose) | where finished decks are kept |
| `DEEPSEEK_*`, `REASONING_EFFORT` | API | see `.env.example` | the AI model |

---

## 8. Known limitations

- **Runner isolation is process-level.** Fine for trusted or internal use, weaker than a microVM for hostile users.
- **A restart mid-build loses that build.** The API sweeps the stale row on boot; the user just retries.
- **Everything is buffered in memory** (the pptx bytes in the runner, then in the API). Fine for normal decks, worth streaming for very large ones.
- **File downloads have no per-user auth.** URLs use ids (not paths), so nothing can escape the storage directory, but anyone who knows a chat id and version can fetch its files. Chat ids are unguessable cuids, which is fine for a personal tool; add real access control before multi-user use.
- **Local Docker volume storage** ties files to one machine. For multiple API replicas, move `STORAGE_DIR` to object storage.
- **The turn is tied to the open HTTP connection.** If the browser disconnects or the API restarts mid-turn, the turn is lost. A durable job queue (for example pg-boss) with resumable SSE would fix this if you need it.
