import OpenAI from "openai";
import { env } from "./env.js";

// DeepSeek is OpenAI-compatible — just point the client at its base URL.
export const llm = new OpenAI({
  // Placeholder keeps the client constructible before a key is configured;
  // an actual request will 401 until DEEPSEEK_API_KEY is set.
  apiKey: env.deepseek.apiKey || "missing-deepseek-api-key",
  baseURL: env.deepseek.baseUrl,
});

export interface StreamHandlers {
  /** Called with each reasoning/thinking token as it streams in. */
  onReasoning?: (delta: string) => void;
  /** Called with each answer token as it streams in. */
  onContent?: (delta: string) => void;
}

export interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatResult {
  content: string;
  reasoning: string;
}

// Reasoning tokens arrive under a provider-specific delta field:
// DeepSeek -> reasoning_content, OpenRouter/others -> reasoning.
interface ReasoningDelta {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
}

const CHAT_SYSTEM_PROMPT =
  "You are a helpful assistant. Think through the problem step by step, then give a clear, concise answer.";

type Msg = OpenAI.Chat.ChatCompletionMessageParam;

/**
 * Build the streaming request. When reasoning is on we send both the standard
 * `reasoning_effort` and DeepSeek V4's `thinking` toggle (the TS SDK has no
 * `extra_body`, so the non-standard field goes inline).
 */
function streamRequest(messages: Msg[]): OpenAI.Chat.ChatCompletionCreateParamsStreaming {
  const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming & Record<string, unknown> = {
    model: env.deepseek.model,
    stream: true,
    messages,
  };
  if (env.deepseek.reasoningEffort !== "off") {
    params.reasoning_effort = env.deepseek.reasoningEffort;
    params.thinking = { type: "enabled" }; // DeepSeek V4 — ignored by models that don't know it
  }
  return params;
}

/** Consume the stream, routing reasoning vs answer deltas to the handlers. */
async function consume(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  handlers: StreamHandlers,
): Promise<ChatResult> {
  let content = "";
  let reasoning = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta as ReasoningDelta | undefined;
    if (!delta) continue;

    const r = delta.reasoning_content ?? delta.reasoning;
    if (r) {
      reasoning += r;
      handlers.onReasoning?.(r);
    }
    if (delta.content) {
      content += delta.content;
      handlers.onContent?.(delta.content);
    }
  }
  return { content, reasoning };
}

/**
 * Stream a normal conversational reply. Yields reasoning + answer tokens via
 * `handlers` and returns the fully assembled result.
 *
 * `reasoning_content` from a prior turn may be left on assistant history
 * messages — DeepSeek ignores it. This app stores it in `Message.meta` instead
 * and only replays `content`.
 */
export async function streamChat(
  history: ChatTurn[],
  handlers: StreamHandlers = {},
): Promise<ChatResult> {
  const messages: Msg[] = [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...history];
  const stream = await llm.chat.completions.create(streamRequest(messages));
  return consume(stream, handlers);
}
