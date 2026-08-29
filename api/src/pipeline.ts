import { prisma } from "./db.js";
import { streamChat, type ChatTurn } from "./llm.js";
import type { ServerEvent } from "./types.js";

type Emit = (e: ServerEvent) => void;

/**
 * Plain reasoning chatbot turn. Reads the chat's message history (the new user
 * message is already persisted by the route), streams reasoning + answer tokens
 * to the client, then persists the assistant reply.
 */
export async function runChatTurn(chatId: string, emit: Emit): Promise<void> {
  const history = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });
  const turns: ChatTurn[] = history.map((m) => ({
    role: m.role as ChatTurn["role"],
    content: m.content,
  }));

  const { content, reasoning } = await streamChat(turns, {
    onReasoning: (text) => emit({ type: "reasoning", text }),
    onContent: (text) => emit({ type: "token", text }),
  });

  const assistant = await prisma.message.create({
    data: {
      chatId,
      role: "assistant",
      content,
      meta: reasoning ? { reasoning } : undefined,
    },
  });
  await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

  emit({
    type: "message",
    message: {
      id: assistant.id,
      role: "assistant",
      content: assistant.content,
      reasoning: reasoning || undefined,
      createdAt: assistant.createdAt.toISOString(),
    },
  });
}
