import { ChevronDown, ChevronRight, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage } from "@/types";

interface Props {
  messages: ChatMessage[];
  reasoning: string;
  streamingCode: string;
  streamingText: string;
  liveTurn: boolean;
  status: string | null;
  disabled: boolean;
  onSend: (text: string) => void;
}

export function ChatPane({
  messages,
  reasoning,
  streamingCode,
  streamingText,
  liveTurn,
  status,
  disabled,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const codeStarted = streamingCode.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-r bg-card">
      <header className="border-b px-4 py-3 text-sm font-semibold">Presentation</header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {messages.length === 0 && !liveTurn && (
            <p className="text-sm text-muted-foreground">
              Describe the presentation you want — e.g. “A 6-slide intro to vector
              databases for engineers.” Then refine it: “make slide 3 a bar chart.”
            </p>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div
                key={m.id}
                className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
              >
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="space-y-2">
                {m.reasoning && <StreamPanel label="Reasoning" text={m.reasoning} />}
                {m.code && <StreamPanel label="Code" text={m.code} mono />}
                <div className="mr-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
                  {m.content}
                </div>
              </div>
            ),
          )}

          {/* live turn: reasoning, then code, then the prose reply */}
          {liveTurn && (
            <div className="space-y-2">
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
                <div className="mr-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
                  {streamingText}
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/50 align-text-bottom" />
                </div>
              )}
            </div>
          )}

          {status && <p className="text-xs text-muted-foreground italic">{status}</p>}
        </div>
      </ScrollArea>

      <form onSubmit={submit} className="border-t p-3">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe or refine the deck…"
            disabled={disabled}
          />
          <Button type="submit" size="icon" disabled={disabled} aria-label="Send">
            <Send />
          </Button>
        </div>
      </form>
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
      className="mr-auto w-[85%] rounded-lg border bg-muted/40"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
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
                ? "max-h-72 overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
                : "max-h-64 overflow-y-auto px-3 pb-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
            }
          >
            {text}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
