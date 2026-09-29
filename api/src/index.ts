import cors from "@fastify/cors";
import Fastify from "fastify";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { registerFileRoutes } from "./files.js";
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

registerFileRoutes(app);

app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
