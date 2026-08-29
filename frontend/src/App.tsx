import { useCallback, useEffect, useRef, useState } from "react";
import { createChat, deleteChat, getChat, listChats, sendMessage } from "@/api";
import { ChatPane } from "@/components/ChatPane";
import { ChatSidebar } from "@/components/ChatSidebar";
import { SlideViewer } from "@/components/SlideViewer";
import type { ChatMessage, ChatSummary, DeckVersionDto } from "@/types";

export default function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [deck, setDeck] = useState<DeckVersionDto | undefined>();
  const [reasoning, setReasoning] = useState("");
  const [streamingCode, setStreamingCode] = useState("");
  const [streamingText, setStreamingText] = useState(""); // the model's prose reply
  const [liveTurn, setLiveTurn] = useState(false); // a turn is streaming right now
  const [building, setBuilding] = useState(false); // sandbox build / render in progress
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bootstrapped = useRef(false);

  const loadChat = useCallback(async (id: string) => {
    setActiveId(id);
    setReasoning("");
    setStreamingCode("");
    setStreamingText("");
    setStatus(null);
    setBuilding(false);
    const chat = await getChat(id);
    setMessages(chat.messages); // each assistant message carries its own reasoning
    setDeck(chat.latestDeck);
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
    setDeck(undefined);
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
    setStreamingCode("");
    setStreamingText("");

    sendMessage(activeId, text, (e) => {
      switch (e.type) {
        case "reasoning":
          setReasoning((prev) => prev + e.text);
          break;
        case "token":
          setStreamingText((prev) => prev + e.text);
          break;
        case "code":
          setStreamingCode((prev) => (e.replace ? e.text : prev + e.text));
          break;
        case "message":
          setMessages((prev) => [...prev, e.message]);
          if (e.message.role === "assistant") {
            setLiveTurn(false);
            setStreamingCode("");
            setStreamingText("");
            setReasoning("");
          }
          break;
        case "chat:title":
          setChats((prev) =>
            prev.map((c) => (c.id === activeId ? { ...c, title: e.title } : c)),
          );
          break;
        case "build:start":
          setStatus(`Building v${e.version}…`);
          setBuilding(true);
          break;
        case "build:progress":
          setStatus(e.step);
          break;
        case "build:done":
          setDeck(e.deck);
          setBuilding(false);
          break;
        case "build:error":
          setStatus(`Build failed: ${e.error}`);
          setBuilding(false);
          break;
        case "error":
          setStatus(`Error: ${e.error}`);
          setBuilding(false);
          break;
        case "done":
          setBusy(false);
          setLiveTurn(false);
          setBuilding(false);
          setStatus(null);
          setStreamingCode("");
          setStreamingText("");
          setReasoning("");
          listChats().then(setChats).catch(() => {});
          break;
      }
    }).catch((err) => {
      setStatus(String(err));
      setBusy(false);
      setLiveTurn(false);
      setBuilding(false);
    });
  }

  return (
    <div className="grid h-full grid-cols-[220px_minmax(340px,1fr)_1.2fr] bg-background text-foreground">
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
        streamingCode={streamingCode}
        streamingText={streamingText}
        liveTurn={liveTurn}
        status={status}
        disabled={busy || !activeId}
        onSend={handleSend}
      />
      <SlideViewer deck={deck} building={building} />
    </div>
  );
}
