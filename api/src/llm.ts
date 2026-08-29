import OpenAI from "openai";
import { env } from "./env.js";

// DeepSeek is OpenAI-compatible — this uses its Responses API.
export const llm = new OpenAI({
  apiKey: env.deepseek.apiKey || "missing-deepseek-api-key",
  baseURL: env.deepseek.baseUrl,
});

export type InputItem = OpenAI.Responses.ResponseInputItem;
export type OutputItem = OpenAI.Responses.ResponseOutputItem;

export interface AgentHandlers {
  onReasoning?: (delta: string) => void; // thinking text
  onText?: (delta: string) => void; // the assistant's prose reply
  onCode?: (delta: string) => void; // raw createSlides({code}) argument fragments
}

export type FunctionCall = OpenAI.Responses.ResponseFunctionToolCall;

export interface AgentStep {
  text: string;
  reasoningText: string;
  /** the model's output items verbatim (reasoning + function_call + message),
   *  replayed on the next request — DeepSeek requires reasoning items passed
   *  back when tools are enabled */
  outputItems: OutputItem[];
  /** every function_call the model made this step (parallel calls are always on) */
  functionCalls: FunctionCall[];
}

const INSTRUCTIONS = `You are a presentation-building assistant.

When the user asks for a slide deck, or a change to one, call the \`createSlides\`
tool with a COMPLETE Python program that uses python-pptx to write "deck.pptx" in
the current working directory. The tool runs your program and replies with either
the slide count (success) or the Python error output. If it returns an error,
read it and call \`createSlides\` again with a corrected program.

If you are shown the program that built the current deck, treat the request as an
edit: change only what the user asked for.

For anything that does not need slides — greetings, questions, clarifications —
just reply normally and do NOT call the tool.

Keep replies to the user brief.`;

const createSlidesTool: OpenAI.Responses.FunctionTool = {
  type: "function",
  name: "createSlides",
  description:
    "Build or revise the slide deck by running a python-pptx program that writes deck.pptx.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          'A complete Python program using python-pptx that saves the presentation as "deck.pptx" in the current directory. Do not touch any other path.',
      },
    },
    required: ["code"],
  },
};

/**
 * One step of the agent loop on the Responses API. Streams reasoning / prose /
 * code fragments to `handlers`; returns the assembled text plus the raw output
 * items (needed to replay reasoning on the next request).
 */
export async function streamAgentStep(
  input: InputItem[],
  handlers: AgentHandlers = {},
): Promise<AgentStep> {
  const params: OpenAI.Responses.ResponseCreateParamsStreaming & Record<string, unknown> = {
    model: env.deepseek.model,
    instructions: INSTRUCTIONS,
    input,
    tools: [createSlidesTool],
    tool_choice: "auto",
    stream: true,
    // DeepSeek: "none" disables thinking; "low" | "high" | "max" set effort.
    reasoning: { effort: env.deepseek.reasoningEffort === "off" ? "none" : env.deepseek.reasoningEffort },
  };

  const stream = await llm.responses.create(params);

  let text = "";
  let reasoningText = "";
  let outputItems: OutputItem[] = [];

  for await (const event of stream) {
    switch (event.type) {
      case "response.reasoning_text.delta":
        reasoningText += event.delta;
        handlers.onReasoning?.(event.delta);
        break;
      case "response.output_text.delta":
        text += event.delta;
        handlers.onText?.(event.delta);
        break;
      case "response.function_call_arguments.delta":
        handlers.onCode?.(event.delta);
        break;
      case "response.completed":
        outputItems = event.response.output;
        break;
      case "response.failed":
        throw new Error(event.response.error?.message ?? "response failed");
      case "response.incomplete":
        throw new Error(
          `response incomplete: ${event.response.incomplete_details?.reason ?? "unknown"}`,
        );
    }
  }

  const functionCalls = outputItems.filter(
    (it): it is FunctionCall => it.type === "function_call",
  );

  return { text, reasoningText, outputItems, functionCalls };
}
