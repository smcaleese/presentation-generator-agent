import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./env.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await registerRoutes(app);

app.listen({ port: env.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
