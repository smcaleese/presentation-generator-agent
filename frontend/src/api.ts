import type { ChatDto, ChatSummary, ServerEvent } from "./types";

export async function listChats(): Promise<ChatSummary[]> {
  const res = await fetch("/api/chats");
  if (!res.ok) throw new Error("failed to list chats");
  return res.json();
}

export async function createChat(): Promise<ChatSummary> {
  const res = await fetch("/api/chats", { method: "POST" });
  if (!res.ok) throw new Error("failed to create chat");
  return res.json();
}

export async function getChat(id: string): Promise<ChatDto> {
  const res = await fetch(`/api/chats/${id}`);
  if (!res.ok) throw new Error("failed to load chat");
  return res.json();
}

export async function deleteChat(id: string): Promise<void> {
  const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error("failed to delete chat");
}

/**
 * POST a chat message and consume the SSE stream.
 * Calls onEvent for every parsed ServerEvent until the stream closes.
 */
export async function sendMessage(
  chatId: string,
  content: string,
  onEvent: (e: ServerEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.body) throw new Error("no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as ServerEvent);
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
}
