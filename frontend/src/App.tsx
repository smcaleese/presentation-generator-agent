import { useCallback, useEffect, useRef, useState } from "react";
import { createChat, deleteChat, getChat, listChats, sendMessage } from "@/api";
import { ChatPane } from "@/components/ChatPane";
import { ChatSidebar } from "@/components/ChatSidebar";
import type { ChatMessage, ChatSummary } from "@/types";

export default function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [liveTurn, setLiveTurn] = useState(false); // a turn is streaming right now
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bootstrapped = useRef(false);

  const loadChat = useCallback(async (id: string) => {
    setActiveId(id);
    setReasoning("");
    setStreamingAnswer("");
    setStatus(null);
    const chat = await getChat(id);
    setMessages(chat.messages); // each assistant message carries its own reasoning
  }, []);

  // bootstrap: load chat list, create one if none, select the newest
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        let list = await listChats();
        if (list.length === 0) list = [await createChat()];
        setChats(list);
        await loadChat(list[0].id);
      } catch (e) {
        setStatus(String(e));
      }
    })();
  }, [loadChat]);

  async function handleCreate() {
    const chat = await createChat();
    setChats((prev) => [chat, ...prev]);
    setMessages([]);
    await loadChat(chat.id);
  }

  async function handleSelect(id: string) {
    if (id === activeId || busy) return;
    await loadChat(id);
  }

  async function handleDelete(id: string) {
    await deleteChat(id);
    const remaining = chats.filter((c) => c.id !== id);
    setChats(remaining);
    if (id === activeId) {
      if (remaining.length > 0) await loadChat(remaining[0].id);
      else await handleCreate();
    }
  }

  function handleSend(text: string) {
    if (!activeId) return;
    setBusy(true);
    setLiveTurn(true);
    setStatus("Thinking…");
    setReasoning("");
    setStreamingAnswer("");

    sendMessage(activeId, text, (e) => {
      switch (e.type) {
        case "reasoning":
          setReasoning((prev) => prev + e.text);
          break;
        case "token":
          setStreamingAnswer((prev) => prev + e.text);
          break;
        case "message":
          setMessages((prev) => [...prev, e.message]);
          if (e.message.role === "assistant") {
            // the finalized message renders its own reasoning panel above the
            // answer — drop the live-turn buffers so we don't show them twice
            setLiveTurn(false);
            setStreamingAnswer("");
            setReasoning("");
          }
          break;
        case "chat:title":
          setChats((prev) =>
            prev.map((c) => (c.id === activeId ? { ...c, title: e.title } : c)),
          );
          break;
        case "error":
          setStatus(`Error: ${e.error}`);
          break;
        case "done":
          setBusy(false);
          setLiveTurn(false);
          setStatus(null);
          setStreamingAnswer("");
          setReasoning("");
          listChats().then(setChats).catch(() => {});
          break;
      }
    }).catch((err) => {
      setStatus(String(err));
      setBusy(false);
      setLiveTurn(false);
    });
  }

  return (
    <div className="grid h-full grid-cols-[240px_1fr] bg-background text-foreground">
      <ChatSidebar
        chats={chats}
        activeId={activeId}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
      />
      <ChatPane
        messages={messages}
        reasoning={reasoning}
        streamingAnswer={streamingAnswer}
        liveTurn={liveTurn}
        thinking={busy}
        status={status}
        disabled={busy || !activeId}
        onSend={handleSend}
      />
    </div>
  );
}
