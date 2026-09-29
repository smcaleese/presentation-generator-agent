import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { registerRoutes } from "./routes.js";
import { checkRunner } from "./runner.js";

const app = Fastify({ logger: true });

// A crash mid-build leaves DeckVersions stuck in "building" — fail them on boot.
await prisma.deckVersion.updateMany({
  where: { status: "building" },
  data: { status: "error", error: "interrupted by server restart" },
});
if (!(await checkRunner())) {
  app.log.error(`runner not reachable at ${env.runnerUrl} — builds will fail until it is up`);
}

await app.register(cors, { origin: true });
await registerRoutes(app);

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
};

// Serve generated slide PNGs / PDFs / PPTX from STORAGE_DIR.
// `?download=<name>` forces a download with that filename.
app.get("/api/files/*", async (req, reply) => {
  const requested = resolve((req.params as { "*": string })["*"]);
  const root = resolve(env.storageDir);
  if (!requested.startsWith(root)) return reply.code(403).send({ error: "forbidden" });
  try {
    await stat(requested);
  } catch {
    return reply.code(404).send({ error: "not found" });
  }
  const ext = requested.slice(requested.lastIndexOf(".")).toLowerCase();
  reply.type(CONTENT_TYPES[ext] ?? "application/octet-stream");

  const download = (req.query as { download?: string }).download;
  if (download) {
    const safe = download.replace(/[^\w.-]/g, "_");
    reply.header("Content-Disposition", `attachment; filename="${safe}"`);
  }
  return reply.send(createReadStream(requested));
});

app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
