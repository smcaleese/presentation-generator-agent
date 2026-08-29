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
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

interface Props {
  messages: ChatMessage[];
  reasoning: string;
  streamingAnswer: string;
  liveTurn: boolean;
  thinking: boolean;
  status: string | null;
  disabled: boolean;
  onSend: (text: string) => void;
}

export function ChatPane({
  messages,
  reasoning,
  streamingAnswer,
  liveTurn,
  thinking,
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

  // the live turn block is shown only while a turn is actively streaming
  const showLiveTurn = liveTurn;

  return (
    <div className="flex h-full flex-col border-r bg-card">
      <header className="border-b px-4 py-3 text-sm font-semibold">Chat</header>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {messages.length === 0 && !showLiveTurn && (
            <p className="text-sm text-muted-foreground">
              Ask anything. The model's reasoning streams in above its answer.
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
                {m.reasoning && <ReasoningPanel text={m.reasoning} live={false} />}
                <div className="mr-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
                  {m.content}
                </div>
              </div>
            ),
          )}

          {/* live turn: reasoning first, then the answer as it streams */}
          {showLiveTurn && (
            <div className="space-y-2">
              {(reasoning || thinking) && <ReasoningPanel text={reasoning} live={thinking} />}
              {streamingAnswer && (
                <div className="mr-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
                  {streamingAnswer}
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
            placeholder="Send a message…"
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

function ReasoningPanel({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live);
  const bodyRef = useRef<HTMLPreElement>(null);

  // expand automatically while it's actively streaming
  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);

  // keep the newest reasoning in view while it streams
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
        <span>Reasoning</span>
        {live && (
          <Badge variant="secondary" className="ml-1 animate-pulse">
            thinking…
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {text && (
          <pre
            ref={bodyRef}
            className="max-h-64 overflow-y-auto px-3 pb-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
          >
            {text}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
