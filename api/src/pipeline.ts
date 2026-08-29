import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { runBuildInSandbox } from "./daytona.js";
import { type InputItem, type OutputItem, streamAgentStep } from "./llm.js";
import { pptxToSlides } from "./render.js";
import type { DeckVersionDto, ServerEvent } from "./types.js";

type Emit = (e: ServerEvent) => void;

const MAX_STEPS = 5; // model turns per user message (tool call + reaction + safety)

const isReasoning = (it: OutputItem): boolean => it.type === "reasoning";

interface BuildOutcome {
  ok: boolean;
  toolResult: string; // fed back to the model
  deck?: DeckVersionDto;
}

/**
 * Agentic turn on the Responses API. The model may call `createSlides` (→ run the
 * code in a Daytona sandbox, render it, feed the result / error back) or just
 * reply in prose. Loops until it answers without a tool call.
 *
 * Emits `reasoning` / `token` (prose) / `code` while the model streams,
 * `build:*` around each tool call, and a final `message`. Never throws.
 */
export async function runTurn(chatId: string, userPrompt: string, emit: Emit): Promise<void> {
  const chat = await prisma.chat.findUniqueOrThrow({ where: { id: chatId } });

  const history = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });
  const latest = await prisma.deckVersion.findFirst({
    where: { chatId, status: "ready" },
    orderBy: { version: "desc" },
  });

  // build the Responses API `input` array
  const input: InputItem[] = [];
  if (latest) {
    input.push({
      role: "developer",
      content:
        "The current deck.pptx was produced by this program. Base edits on it:\n" +
        "```python\n" +
        latest.buildCode +
        "\n```",
    });
  }
  for (const m of history) {
    if (m.role === "assistant") {
      // DeepSeek requires reasoning items replayed when tools are enabled
      const meta = (m.meta ?? {}) as { reasoningItems?: unknown };
      if (Array.isArray(meta.reasoningItems)) {
        input.push(...(meta.reasoningItems as InputItem[]));
      }
      input.push({ role: "assistant", content: m.content });
    } else {
      input.push({ role: "user", content: m.content });
    }
  }
  input.push({ role: "user", content: userPrompt });

  let reasoningAll = "";
  let lastCode = "";
  let lastReasoningItems: OutputItem[] = [];

  const persist = async (content: string) => {
    const meta: Record<string, unknown> = {};
    if (reasoningAll) meta.reasoning = reasoningAll;
    if (lastCode) meta.buildCode = lastCode;
    const reItems = lastReasoningItems.filter(isReasoning);
    if (reItems.length) meta.reasoningItems = reItems;

    const row = await prisma.message.create({
      data: {
        chatId,
        role: "assistant",
        content,
        meta: Object.keys(meta).length ? (meta as object) : undefined,
      },
    });
    await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
    emit({
      type: "message",
      message: {
        id: row.id,
        role: "assistant",
        content,
        reasoning: reasoningAll || undefined,
        code: lastCode || undefined,
        createdAt: row.createdAt.toISOString(),
      },
    });
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const { text, reasoningText, outputItems, functionCalls } = await streamAgentStep(input, {
      onReasoning: (t) => emit({ type: "reasoning", text: t }),
      onText: (t) => emit({ type: "token", text: t }),
      onCode: (t) => emit({ type: "code", text: t }),
    });
    if (reasoningText) {
      reasoningAll = reasoningAll ? `${reasoningAll}\n\n---\n\n${reasoningText}` : reasoningText;
    }
    lastReasoningItems = outputItems;

    if (functionCalls.length === 0) {
      await persist(text.trim() || "Done.");
      return;
    }

    // replay the model's output items (reasoning + every function_call) verbatim,
    // then one function_call_output per call — DeepSeek 400s on a missing output.
    input.push(...(outputItems as InputItem[]));
    for (const call of functionCalls) {
      let toolResult: string;
      if (call.name !== "createSlides") {
        toolResult = `Error: unknown tool "${call.name}".`;
      } else {
        let code: string | undefined;
        try {
          const parsed = JSON.parse(call.arguments) as { code?: unknown };
          if (typeof parsed.code === "string" && parsed.code.trim()) code = parsed.code;
        } catch {
          /* fall through */
        }
        if (!code) {
          toolResult = "Error: createSlides needs a non-empty `code` argument (valid JSON).";
        } else {
          lastCode = code;
          emit({ type: "code", text: code, replace: true }); // snap panel to clean code
          toolResult = (await runBuild(chat.id, code, emit)).toolResult;
        }
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output: toolResult });
    }
  }

  await persist("I couldn't get the deck to build after several attempts — see the errors above.");
}

/** Run one createSlides call: sandbox → render → persist a DeckVersion. */
async function runBuild(chatId: string, code: string, emit: Emit): Promise<BuildOutcome> {
  const chat = await prisma.chat.findUniqueOrThrow({ where: { id: chatId } });
  const prior = await prisma.deckVersion.findFirst({
    where: { chatId },
    orderBy: { version: "desc" },
  });
  const version = (prior?.version ?? 0) + 1;
  emit({ type: "build:start", version });

  const deck = await prisma.deckVersion.create({
    data: { chatId, version, buildCode: code, status: "building" },
  });

  try {
    emit({ type: "build:progress", step: "running in sandbox" });
    const { pptxBytes, sandboxId } = await runBuildInSandbox(code, chat.sandboxId ?? undefined);
    if (sandboxId !== chat.sandboxId) {
      await prisma.chat.update({ where: { id: chatId }, data: { sandboxId } });
    }

    emit({ type: "build:progress", step: "rendering slides" });
    const { pdfBytes, slidePngs } = await pptxToSlides(pptxBytes);

    const dir = join(env.storageDir, chatId, String(version));
    await mkdir(dir, { recursive: true });
    const pptxPath = join(dir, "deck.pptx");
    const pdfPath = join(dir, "deck.pdf");
    await writeFile(pptxPath, pptxBytes);
    await writeFile(pdfPath, pdfBytes);
    const slides = await Promise.all(
      slidePngs.map(async (png, i) => {
        const imagePath = join(dir, `slide-${i + 1}.png`);
        await writeFile(imagePath, png);
        return { index: i, imagePath };
      }),
    );

    const ready = await prisma.deckVersion.update({
      where: { id: deck.id },
      data: { status: "ready", pptxPath, pdfPath, slides: { create: slides } },
      include: { slides: { orderBy: { index: "asc" } } },
    });
    const dto = toDeckDto(ready);
    emit({ type: "build:done", deck: dto });

    const n = slidePngs.length;
    return { ok: true, deck: dto, toolResult: `Success: built deck v${version} with ${n} slide${n === 1 ? "" : "s"}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.deckVersion.update({
      where: { id: deck.id },
      data: { status: "error", error: message },
    });
    emit({ type: "build:error", error: message });
    return {
      ok: false,
      toolResult:
        `Error — your program did not produce slides:\n${message}\n\n` +
        "Fix the program and call createSlides again.",
    };
  }
}

const fileUrl = (path: string, downloadAs?: string) =>
  `/api/files/${encodeURIComponent(path)}${downloadAs ? `?download=${encodeURIComponent(downloadAs)}` : ""}`;

export function toDeckDto(deck: {
  id: string;
  version: number;
  status: string;
  error: string | null;
  reasoning?: string | null;
  pptxPath?: string | null;
  pdfPath?: string | null;
  slides: { index: number; imagePath: string }[];
}): DeckVersionDto {
  return {
    id: deck.id,
    version: deck.version,
    status: deck.status as DeckVersionDto["status"],
    error: deck.error ?? undefined,
    reasoning: deck.reasoning ?? undefined,
    pptxUrl: deck.pptxPath ? fileUrl(deck.pptxPath, `deck-v${deck.version}.pptx`) : undefined,
    pdfUrl: deck.pdfPath ? fileUrl(deck.pdfPath, `deck-v${deck.version}.pdf`) : undefined,
    slides: deck.slides.map((s) => ({
      index: s.index,
      imageUrl: fileUrl(s.imagePath),
    })),
  };
}
