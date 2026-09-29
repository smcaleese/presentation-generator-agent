import { ChevronDown, ChevronRight, PanelLeft, Presentation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Composer } from "@/components/Composer";
import { DeckChip } from "@/components/DeckChip";
import type { ChatMessage } from "@/types";

const SUGGESTIONS = [
  { label: "Intro to vector databases", prompt: "A 6-slide intro to vector databases for engineers" },
  { label: "Quarterly business review", prompt: "A quarterly business review for the sales team" },
  { label: "Product launch plan", prompt: "A product launch plan with timeline and risks" },
];

interface Props {
  title: string;
  deckMeta?: string; // e.g. "5 slides · v2"
  hasDeck: boolean;
  viewingVersion?: number;
  messages: ChatMessage[];
  reasoning: string;
  streamingCode: string;
  streamingText: string;
  liveTurn: boolean;
  status: string | null;
  disabled: boolean;
  onSend: (text: string) => void;
  onOpenDeck: (version: number) => void;
  onOpenSidebar?: () => void; // narrow screens only
}

export function ChatPane({
  title,
  deckMeta,
  hasDeck,
  viewingVersion,
  messages,
  reasoning,
  streamingCode,
  streamingText,
  liveTurn,
  status,
  disabled,
  onSend,
  onOpenDeck,
  onOpenSidebar,
}: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // keep the newest content in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, reasoning, streamingCode, streamingText, status, liveTurn]);

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft("");
  }

  const codeStarted = streamingCode.length > 0;
  const empty = messages.length === 0 && !liveTurn;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        {onOpenSidebar && (
          <Button variant="ghost" size="icon" onClick={onOpenSidebar} aria-label="Open sidebar">
            <PanelLeft />
          </Button>
        )}
        <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>
        {deckMeta && <span className="shrink-0 text-xs text-muted-foreground">{deckMeta}</span>}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth px-5 pt-6 pb-2">
        <div className="mx-auto flex max-w-[720px] flex-col gap-5" aria-live="polite">
          {empty && (
            <div className="mx-auto mt-[8vh] max-w-lg text-center">
              <div className="mx-auto mb-4 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Presentation className="size-5" />
              </div>
              <h2 className="mb-1.5 text-xl font-semibold tracking-tight">What should we present?</h2>
              <p className="mb-5 text-sm text-muted-foreground">
                Describe a deck and I'll write it, build it, and show it on the right.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      setDraft(s.prompt);
                      inputRef.current?.focus();
                    }}
                    className="h-8 rounded-full border bg-card px-3 text-sm transition hover:border-primary hover:bg-primary-soft"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground [overflow-wrap:anywhere]">
                  {m.content}
                </div>
              </div>
            ) : (
              <AssistantRow key={m.id}>
                {m.reasoning && <StreamPanel label="Reasoning" text={m.reasoning} />}
                {m.code && <StreamPanel label="Code" text={m.code} mono />}
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{m.content}</p>
                {m.deck && (
                  <DeckChip
                    version={m.deck.version}
                    slideCount={m.deck.slideCount}
                    active={viewingVersion === m.deck.version}
                    onClick={() => onOpenDeck(m.deck!.version)}
                  />
                )}
              </AssistantRow>
            ),
          )}

          {/* live turn: reasoning, then code, then the prose reply */}
          {liveTurn && (
            <AssistantRow>
              <StreamPanel
                label="Reasoning"
                text={reasoning}
                live={!codeStarted && !streamingText}
                badge="thinking…"
              />
              {codeStarted && (
                <StreamPanel
                  label="Code"
                  text={streamingCode}
                  live={!streamingText}
                  mono
                  badge="writing…"
                />
              )}
              {streamingText && (
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {streamingText}
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/50 align-text-bottom" />
                </p>
              )}
              {status && (
                <div className="flex items-center gap-2.5 pt-0.5 text-sm text-muted-foreground">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
                  <span>{status}</span>
                </div>
              )}
            </AssistantRow>
          )}

          {/* outside a live turn a status is an error/notice (e.g. "Build failed: …") */}
          {!liveTurn && status && <p className="text-sm text-destructive">{status}</p>}
        </div>
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        disabled={disabled}
        placeholder={hasDeck ? "Ask for changes to the deck…" : "Describe the deck you want…"}
        textareaRef={inputRef}
      />
    </div>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="mt-px grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
        <Presentation className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">{children}</div>
    </div>
  );
}

interface PanelProps {
  label: string;
  text: string;
  live?: boolean;
  mono?: boolean;
  badge?: string;
}

function StreamPanel({ label, text, live = false, mono = false, badge }: PanelProps) {
  const [open, setOpen] = useState(live);
  const bodyRef = useRef<HTMLPreElement>(null);

  // open while this panel is the one streaming; collapse once it's done
  useEffect(() => {
    setOpen(live);
  }, [live]);

  // keep the newest text in view while it streams
  useEffect(() => {
    if (live && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, live, open]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="w-full overflow-hidden rounded-[10px] border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition hover:text-foreground">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <span>{label}</span>
        {live && badge && (
          <Badge variant="secondary" className="ml-1 animate-pulse">
            {badge}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {text && (
          <pre
            ref={bodyRef}
            className={
              mono
                ? "max-h-72 overflow-auto border-t bg-muted px-3.5 py-3 font-mono text-[12px] leading-relaxed text-foreground"
                : "max-h-64 overflow-y-auto border-t px-3.5 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
            }
          >
            {text}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
