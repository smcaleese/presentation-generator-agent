import { useCallback, useEffect, useRef, useState } from "react";
import { createChat, deleteChat, getChat, listChats, renameChat, sendMessage } from "@/api";
import { ChatPane } from "@/components/ChatPane";
import { ChatSidebar } from "@/components/ChatSidebar";
import { SlideViewer } from "@/components/SlideViewer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSummary, DeckVersionDto } from "@/types";

const SIDEBAR_KEY = "pga-sidebar";

export default function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [decks, setDecks] = useState<DeckVersionDto[]>([]); // every ready version, oldest first
  const [viewing, setViewing] = useState<number | undefined>(); // version shown in the previewer (default: latest)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const isNarrow = useMediaQuery("(max-width: 900px)");
  const [drawerOpen, setDrawerOpen] = useState(false); // narrow screens: sidebar drawer
  const [tab, setTab] = useState<"chat" | "preview">("chat"); // narrow screens: which panel
  const [reasoning, setReasoning] = useState("");
  const [streamingCode, setStreamingCode] = useState("");
  const [streamingText, setStreamingText] = useState(""); // the model's prose reply
  const [liveTurn, setLiveTurn] = useState(false); // a turn is streaming right now
  const [building, setBuilding] = useState(false); // deck build / render in progress
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bootstrapped = useRef(false);

  const latest = decks.at(-1);
  const deck = decks.find((d) => d.version === viewing) ?? latest;
  const activeChat = chats.find((c) => c.id === activeId);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "open");
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  const loadChat = useCallback(async (id: string) => {
    setActiveId(id);
    setReasoning("");
    setStreamingCode("");
    setStreamingText("");
    setStatus(null);
    setBuilding(false);
    const chat = await getChat(id);
    setMessages(chat.messages); // each assistant message carries its own reasoning
    setDecks(chat.decks);
    setViewing(undefined);
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
    setDecks([]);
    setViewing(undefined);
    await loadChat(chat.id);
    setDrawerOpen(false);
    setTab("chat");
  }

  async function handleSelect(id: string) {
    setDrawerOpen(false);
    setTab("chat");
    if (id === activeId || busy) return;
    await loadChat(id);
  }

  async function handleRename(id: string, title: string) {
    const previous = chats.find((c) => c.id === id)?.title;
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c))); // optimistic
    try {
      await renameChat(id, title);
    } catch {
      if (previous !== undefined) {
        setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title: previous } : c)));
      }
      setStatus("Couldn't rename the chat.");
    }
  }

  function handleOpenDeck(version: number) {
    setViewing(version);
    setTab("preview");
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
          setDecks((prev) => [...prev.filter((d) => d.version !== e.deck.version), e.deck]);
          setViewing(e.deck.version);
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

  const sidebar = (
    <ChatSidebar
      chats={chats}
      activeId={activeId}
      collapsed={isNarrow ? false : collapsed}
      onToggle={() => (isNarrow ? setDrawerOpen(false) : setCollapsed((c) => !c))}
      onSelect={handleSelect}
      onCreate={handleCreate}
      onRename={handleRename}
      onDelete={handleDelete}
    />
  );

  const chatPane = (
    <ChatPane
      title={activeChat?.title ?? "New chat"}
      deckMeta={latest ? `${latest.slides.length} slides · v${latest.version}` : undefined}
      hasDeck={decks.length > 0}
      viewingVersion={deck?.version}
      messages={messages}
      reasoning={reasoning}
      streamingCode={streamingCode}
      streamingText={streamingText}
      liveTurn={liveTurn}
      status={status}
      disabled={busy || !activeId}
      onSend={handleSend}
      onOpenDeck={handleOpenDeck}
      onOpenSidebar={isNarrow ? () => setDrawerOpen(true) : undefined}
    />
  );

  const preview = (
    <SlideViewer deck={deck} title={activeChat?.title ?? "Preview"} building={building} />
  );

  if (isNarrow) {
    return (
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {drawerOpen && (
          <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setDrawerOpen(false)} />
        )}
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-40 shadow-lg transition-transform duration-200",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {sidebar}
        </div>
        <div role="tablist" aria-label="View" className="mx-4 mt-2 flex shrink-0 gap-1 rounded-lg bg-muted p-1">
          {(["chat", "preview"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "h-7 flex-1 rounded-md text-sm font-medium capitalize transition",
                tab === t ? "bg-card text-foreground shadow-xs" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-2 min-h-0 flex-1">{tab === "chat" ? chatPane : preview}</div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-background text-foreground">
      {sidebar}
      <ResizablePanelGroup direction="horizontal" autoSaveId="pga-layout-v2" className="min-w-0 flex-1">
        <ResizablePanel defaultSize={46} minSize={28} className="min-w-0">
          {chatPane}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={54} minSize={28} className="min-w-0">
          {preview}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
