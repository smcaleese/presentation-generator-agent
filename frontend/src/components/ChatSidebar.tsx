import { MessageSquarePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatSummary } from "@/types";

interface Props {
  chats: ChatSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}

export function ChatSidebar({ chats, activeId, onSelect, onCreate, onDelete }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-r bg-muted/30">
      <div className="p-3">
        <Button onClick={onCreate} className="w-full justify-start gap-2" size="sm">
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ul className="space-y-0.5 px-2 pb-2">
          {chats.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">No chats yet</li>
          )}
          {chats.map((c) => (
            <li key={c.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  c.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="flex-1 truncate text-left"
                  title={c.title}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  aria-label="Delete chat"
                  className="shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
