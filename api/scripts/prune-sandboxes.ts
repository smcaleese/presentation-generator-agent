/**
 * List Daytona sandboxes on the account, and (with --delete) remove them.
 *
 *   npm run sandboxes:list            # read-only
 *   npm run sandboxes:prune           # delete stopped sandboxes
 *   npm run sandboxes:prune -- --all  # delete every sandbox (running too)
 *
 * Sandboxes are recreated on demand by getOrCreateSandbox, so pruning is safe —
 * a chat mid-edit just loses its warm sandbox and rebuilds from scratch.
 */
import { Daytona } from "@daytona/sdk";
import { env } from "../src/env.js";

const wantDelete = process.argv.includes("--delete") || process.argv.includes("--all");
const includeRunning = process.argv.includes("--all");

const daytona = new Daytona({ apiKey: env.daytonaApiKey });

const sandboxes = [];
for await (const s of daytona.list()) sandboxes.push(s);

const row = (s: unknown) => {
  const o = s as Record<string, unknown>;
  return {
    id: String(o.id),
    state: String(o.state ?? o.status ?? "?"),
    created: String(o.createdAt ?? o.created_at ?? ""),
  };
};

console.log(`${sandboxes.length} sandbox(es):`);
for (const s of sandboxes) {
  const r = row(s);
  console.log(`  ${r.id}  ${r.state.padEnd(8)}  ${r.created}`);
}

if (!wantDelete) {
  console.log("\n(read-only — pass --delete to remove stopped ones, --all for everything)");
  process.exit(0);
}

const targets = sandboxes.filter((s) => includeRunning || row(s).state === "stopped");
console.log(`\ndeleting ${targets.length} sandbox(es)${includeRunning ? " (including running)" : " (stopped only)"}…`);

for (const s of targets) {
  const id = row(s).id;
  try {
    await daytona.delete(s, 60, true);
    console.log(`  deleted ${id}`);
  } catch (e) {
    console.log(`  FAILED  ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let left = 0;
for await (const _ of daytona.list()) left++;
console.log(`\nremaining: ${left}`);
