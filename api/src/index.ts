import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./env.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await registerRoutes(app);

// Serve generated slide PNGs / PDFs from STORAGE_DIR.
app.get("/api/files/*", async (req, reply) => {
  const requested = resolve((req.params as { "*": string })["*"]);
  const root = resolve(env.storageDir);
  if (!requested.startsWith(root)) return reply.code(403).send({ error: "forbidden" });
  try {
    await stat(requested);
  } catch {
    return reply.code(404).send({ error: "not found" });
  }
  reply.type(requested.endsWith(".pdf") ? "application/pdf" : "image/png");
  return reply.send(createReadStream(requested));
});

app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
