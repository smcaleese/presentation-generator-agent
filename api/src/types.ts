// Hand-maintained shared contract between api/ and frontend/.
// Keep this file in sync with frontend/src/types.ts.

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  reasoning?: string; // assistant only — the model's thinking trace
  code?: string; // assistant only — the python-pptx it wrote
  createdAt: string;
}

export interface SlideDto {
  index: number;
  imageUrl: string;
}

export interface DeckVersionDto {
  id: string;
  version: number;
  status: "pending" | "building" | "ready" | "error";
  error?: string;
  reasoning?: string;
  slides: SlideDto[];
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
  latestDeck?: DeckVersionDto;
}

// ---- Server-Sent Events streamed from POST /api/chats/:id/messages ----

export type ServerEvent =
  | { type: "reasoning"; text: string } // model thinking tokens, streamed
  | { type: "token"; text: string } // the assistant's prose reply, streamed
  | { type: "code"; text: string; replace?: boolean } // createSlides code; replace=true swaps in the clean parsed version
  | { type: "message"; message: ChatMessage } // a finalized, persisted message
  | { type: "chat:title"; title: string } // chat was auto-named from its first message
  | { type: "error"; error: string }
  | { type: "done" }
  // --- deck build (Daytona path) ---
  | { type: "build:start"; version: number }
  | { type: "build:progress"; step: string }
  | { type: "build:done"; deck: DeckVersionDto }
  | { type: "build:error"; error: string };
