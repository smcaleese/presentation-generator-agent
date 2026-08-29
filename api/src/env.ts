import { config } from "dotenv";

// Single .env lives at the repo root (one dir up from api/).
config({ path: new URL("../../.env", import.meta.url) });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// DeepSeek's thinking scale is low | high | max (+ "none" to disable). It has no
// "medium" — we accept it as a friendly alias for "high" (the middle rung).
function reasoningEffort(raw: string | undefined): "low" | "high" | "max" | "off" {
  switch ((raw ?? "medium").toLowerCase()) {
    case "off":
    case "none":
      return "off";
    case "low":
      return "low";
    case "max":
      return "max";
    default: // "medium", "high", or anything unrecognized
      return "high";
  }
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  daytonaApiKey: process.env.DAYTONA_API_KEY ?? "",
  storageDir: process.env.STORAGE_DIR ?? "./storage",
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    reasoningEffort: reasoningEffort(process.env.REASONING_EFFORT),
  },
};
