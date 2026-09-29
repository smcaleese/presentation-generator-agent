"""Stateless build runner: POST /build {chat_id, message_id, code} -> deck.pptx bytes.

Each build runs `python build.py` in a throwaway directory
`BUILD_ROOT/<chat_id>/<message_id>/` as a subprocess with a scrubbed environment,
resource limits, a wall-clock timeout, and its own process group (killed as a unit
on timeout). The directory is deleted when the build ends.

Directory creation doubles as a lock: a second build for the same message gets 409.
Run with a single uvicorn worker — the mkdir/rmdir bookkeeping relies on the event
loop not interleaving the sync sections (there is no `await` inside them).
"""

import asyncio
import os
import re
import resource
import shutil
import signal
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT", "3"))
TIMEOUT_S = int(os.getenv("BUILD_TIMEOUT_S", "60"))
TOKEN = os.getenv("RUNNER_TOKEN", "")
BUILD_ROOT = os.getenv("BUILD_ROOT", "/tmp/builds")
OUTPUT_TAIL = 8000  # chars of stdout/stderr returned to the model
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")  # ids become path segments — no "/" or ".."

slots = asyncio.Semaphore(MAX_CONCURRENT)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # drop anything a previous process left behind (a stale dir would 409 forever)
    shutil.rmtree(BUILD_ROOT, ignore_errors=True)
    os.makedirs(BUILD_ROOT, exist_ok=True)
    yield


app = FastAPI(lifespan=lifespan)


class BuildReq(BaseModel):
    chat_id: str
    message_id: str
    code: str


def _limits() -> None:
    # runs in the child before exec
    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT_S, TIMEOUT_S))
    resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))  # 1 GiB memory
    resource.setrlimit(resource.RLIMIT_FSIZE, (100 << 20, 100 << 20))  # 100 MiB files
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))


@app.get("/health")
async def health():
    return {"ok": True, "busy": slots.locked()}


@app.post("/build")
async def build(req: BuildReq, authorization: str = Header(default="")):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401)
    if not (ID_RE.match(req.chat_id) and ID_RE.match(req.message_id)):
        raise HTTPException(400, "invalid chat_id or message_id")
    if slots.locked():  # no await between this check and the acquire below
        return JSONResponse({"error": "busy"}, status_code=429)

    chat_dir = os.path.join(BUILD_ROOT, req.chat_id)
    work = os.path.join(chat_dir, req.message_id)
    async with slots:
        os.makedirs(chat_dir, exist_ok=True)
        try:
            os.mkdir(work)  # atomic: fails if this message's build is already running
        except FileExistsError:
            return JSONResponse({"error": "build already running"}, status_code=409)
        try:
            with open(os.path.join(work, "build.py"), "w") as f:
                f.write(req.code)
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "build.py",
                cwd=work,
                env={"PATH": os.environ["PATH"], "HOME": work},  # scrubbed: no secrets
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                start_new_session=True,
                preexec_fn=_limits,
            )
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), TIMEOUT_S)
            except asyncio.TimeoutError:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)  # whole process group
                except ProcessLookupError:
                    pass  # already gone (e.g. RLIMIT_CPU killed it first)
                await proc.wait()
                return JSONResponse(
                    {"output": f"build timed out after {TIMEOUT_S}s"}, status_code=422
                )

            text = out.decode(errors="replace")[-OUTPUT_TAIL:]
            deck = os.path.join(work, "deck.pptx")
            if proc.returncode != 0 or not os.path.exists(deck):
                msg = text or "program exited without writing deck.pptx"
                return JSONResponse({"output": msg}, status_code=422)
            with open(deck, "rb") as f:
                return Response(f.read(), media_type="application/octet-stream")
        finally:
            shutil.rmtree(work, ignore_errors=True)
            try:
                os.rmdir(chat_dir)  # only succeeds when no other build is using this chat
            except OSError:
                pass
