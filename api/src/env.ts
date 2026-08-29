import { config } from "dotenv";

// Single .env lives at the repo root (one dir up from api/).
config({ path: new URL("../../.env", import.meta.url) });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    // "low" | "medium" | "high" — or "off" to omit the param for non-reasoning models
    reasoningEffort: (process.env.REASONING_EFFORT ?? "medium") as
      | "low"
      | "medium"
      | "high"
      | "off",
  },
};
