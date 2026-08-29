import { Daytona, type Sandbox } from "@daytona/sdk";
import { env } from "./env.js";

let client: Daytona | null = null;
function daytona(): Daytona {
  if (!client) client = new Daytona({ apiKey: env.daytonaApiKey });
  return client;
}

/**
 * Get this chat's sandbox, or create a fresh generic Python one.
 * Reused across turns so deck edits are incremental (the previous
 * deck.pptx is still in the working directory).
 */
export async function getOrCreateSandbox(sandboxId?: string): Promise<Sandbox> {
  if (sandboxId) {
    try {
      return await daytona().get(sandboxId);
    } catch {
      // stale / reaped — fall through and make a new one
    }
  }
  return daytona().create({
    language: "python",
    autoStopInterval: 10, // minutes idle -> stop
    autoDeleteInterval: 5, // minutes stopped -> delete (keeps the quota clean)
  });
}

export async function deleteSandbox(sandboxId: string): Promise<void> {
  const sandbox = await daytona().get(sandboxId);
  await daytona().delete(sandbox);
}

export interface SandboxBuildResult {
  pptxBytes: Buffer;
  sandboxId: string;
}

const ENSURE_PPTX =
  "python -c 'import pptx' 2>/dev/null || " +
  "pip install -q python-pptx 2>/dev/null || " +
  "pip install -q --break-system-packages python-pptx";

/**
 * Run the model's python-pptx program in the sandbox and return the .pptx bytes.
 * The program is expected to write `deck.pptx` in the working directory.
 */
export async function runBuildInSandbox(
  buildCode: string,
  sandboxId?: string,
): Promise<SandboxBuildResult> {
  const sandbox = await getOrCreateSandbox(sandboxId);

  const ensure = await sandbox.process.executeCommand(ENSURE_PPTX, undefined, undefined, 180);
  if (ensure.exitCode !== 0) {
    throw new Error(`could not install python-pptx in sandbox:\n${ensure.result}`);
  }

  await sandbox.fs.uploadFile(Buffer.from(buildCode, "utf8"), "build.py");

  const run = await sandbox.process.executeCommand("python build.py", undefined, undefined, 120);
  if (run.exitCode !== 0) {
    throw new Error(`build.py failed (exit ${run.exitCode}):\n${run.result}`);
  }

  const pptxBytes = await sandbox.fs.downloadFile("deck.pptx");
  return { pptxBytes, sandboxId: sandbox.id };
}
