// Hand-maintained shared contract between api/ and frontend/.
// Keep this file in sync with frontend/src/types.ts.

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  reasoning?: string; // assistant only — the model's thinking trace
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatDto {
  id: string;
  title: string;
  messages: ChatMessage[];
}

// ---- Server-Sent Events streamed from POST /api/chats/:id/messages ----

export type ServerEvent =
  | { type: "reasoning"; text: string } // model thinking tokens, streamed
  | { type: "token"; text: string } // answer tokens, streamed
  | { type: "message"; message: ChatMessage } // a finalized, persisted message
  | { type: "chat:title"; title: string } // chat was auto-named from its first message
  | { type: "error"; error: string }
  | { type: "done" };
