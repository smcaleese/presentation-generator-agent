import pLimit from "p-limit";
import { env } from "./env.js";

const slots = pLimit(env.maxConcurrentBuilds);

/** The model's program failed — the message is fed back to the model to fix. */
export class BuildError extends Error {}

export const isBusy = () => slots.activeCount >= env.maxConcurrentBuilds;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the python-pptx program in the runner service and return the .pptx bytes.
 * The runner builds in /tmp/builds/<chatId>/<messageId>/ (user message that triggered it).
 */
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
      } catch (err) {
        if (attempt < 2) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new Error(`runner unreachable: ${err instanceof Error ? err.message : err}`);
      }
      if (res.status === 200) return Buffer.from(await res.arrayBuffer());
      if (res.status === 422) {
        const { output } = (await res.json()) as { output: string };
        throw new BuildError(`build.py failed:\n${output}`);
      }
      // 429 = runner full, 409 = a build for this message is still finishing (e.g. our own timed-out retry)
      if ((res.status === 429 || res.status === 409 || res.status === 503) && attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new Error(`runner error (${res.status})`);
    }
  });
}

/** Boot-time check so a missing/misconfigured runner is obvious immediately. */
export async function checkRunner(): Promise<boolean> {
  try {
    const res = await fetch(`${env.runnerUrl}/health`, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}
