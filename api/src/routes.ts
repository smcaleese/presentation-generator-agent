import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.js";
import { deleteSandbox } from "./daytona.js";
import { runTurn, toDeckDto } from "./pipeline.js";
import type { ChatDto, ChatSummary, ServerEvent } from "./types.js";

const DEFAULT_TITLE = "New chat";

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true }));

  // --- chats ---
  app.get("/api/chats", async (): Promise<ChatSummary[]> => {
    const chats = await prisma.chat.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { messages: true } } },
    });
    return chats.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
    }));
  });

  app.post("/api/chats", async (req): Promise<ChatSummary> => {
    const body = z.object({ title: z.string().trim().min(1).optional() }).parse(req.body ?? {});
    const chat = await prisma.chat.create({
      data: { title: body.title ?? DEFAULT_TITLE },
      include: { _count: { select: { messages: true } } },
    });
    return {
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt.toISOString(),
      messageCount: chat._count.messages,
    };
  });

  app.get("/api/chats/:id", async (req, reply): Promise<ChatDto | void> => {
    const { id } = req.params as { id: string };
    const chat = await prisma.chat.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        deckVersions: {
          orderBy: { version: "desc" },
          take: 1,
          include: { slides: { orderBy: { index: "asc" } } },
        },
      },
    });
    if (!chat) return reply.code(404).send({ error: "not found" });

    return {
      id: chat.id,
      title: chat.title,
      messages: chat.messages.map((m) => {
        const meta = (m.meta ?? {}) as { reasoning?: unknown; buildCode?: unknown };
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          reasoning: meta.reasoning ? String(meta.reasoning) : undefined,
          code: meta.buildCode ? String(meta.buildCode) : undefined,
          createdAt: m.createdAt.toISOString(),
        };
      }),
      latestDeck: chat.deckVersions[0] ? toDeckDto(chat.deckVersions[0]) : undefined,
    };
  });

  app.delete("/api/chats/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const chat = await prisma.chat.findUnique({ where: { id }, select: { sandboxId: true } });
    if (chat?.sandboxId) await deleteSandbox(chat.sandboxId).catch(() => {});
    await prisma.chat.delete({ where: { id } }).catch(() => {});
    return reply.code(204).send();
  });

  // --- deck build turn: streams reasoning + code + build progress over SSE ---
  const bodySchema = z.object({ content: z.string().min(1) });

  app.post("/api/chats/:id/messages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { content } = bodySchema.parse(req.body);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // stop nginx-style proxies buffering the stream
    });
    const emit = (e: ServerEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);

    const chat = await prisma.chat.findUnique({ where: { id }, select: { title: true } });
    if (!chat) {
      emit({ type: "error", error: "chat not found" });
      emit({ type: "done" });
      return reply.raw.end();
    }

    const userMsg = await prisma.message.create({
      data: { chatId: id, role: "user", content },
    });
    emit({
      type: "message",
      message: {
        id: userMsg.id,
        role: "user",
        content: userMsg.content,
        createdAt: userMsg.createdAt.toISOString(),
      },
    });

    // name the chat after its first user message
    if (chat.title === DEFAULT_TITLE) {
      const title = titleFrom(content);
      await prisma.chat.update({ where: { id }, data: { title } });
      emit({ type: "chat:title", title });
    }

    try {
      await runTurn(id, content, emit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "error", error: message });
    } finally {
      emit({ type: "done" });
      reply.raw.end();
    }
  });
}
