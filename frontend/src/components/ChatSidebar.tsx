import { MessageSquare, MoreHorizontal, PanelLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ChatSummary } from "@/types";

interface Props {
  chats: ChatSummary[];
  activeId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function ChatSidebar({
  chats,
  activeId,
  collapsed,
  onToggle,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  return (
    <aside
      aria-label="Chats"
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-16" : "w-72",
      )}
    >
      {/* top: New chat + collapse toggle (no brand) */}
      <div className={cn("flex gap-2 p-3", collapsed ? "flex-col items-center px-0" : "items-center")}>
        <Button
          variant="outline"
          onClick={onCreate}
          title="New chat"
          className={cn(
            "h-9 bg-card",
            collapsed ? "order-2 w-10 px-0" : "flex-1 justify-start gap-2",
          )}
        >
          <Plus />
          {!collapsed && <span>New chat</span>}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn("text-muted-foreground", collapsed && "order-1")}
        >
          <PanelLeft />
        </Button>
      </div>

      {!collapsed ? (
        <>
          <div className="px-5 pt-1 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Recent
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {chats.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No chats yet</li>
            )}
            {chats.map((c) => (
              <ChatRow
                key={c.id}
                chat={c}
                active={c.id === activeId}
                renaming={renamingId === c.id}
                menuOpen={menuOpenId === c.id}
                onMenuOpenChange={(open) => setMenuOpenId(open ? c.id : null)}
                onSelect={() => onSelect(c.id)}
                onStartRename={() => setRenamingId(c.id)}
                onFinishRename={(title) => {
                  setRenamingId(null);
                  if (title && title !== c.title) onRename(c.id, title);
                }}
                onDelete={() => onDelete(c.id)}
              />
            ))}
          </ul>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <div
        className={cn(
          "flex items-center border-t p-2 text-xs text-muted-foreground",
          collapsed ? "justify-center" : "justify-between pl-4",
        )}
      >
        {!collapsed && (
          <span>
            {chats.length} {chats.length === 1 ? "chat" : "chats"}
          </span>
        )}
        <ThemeToggle />
      </div>
    </aside>
  );
}

interface RowProps {
  chat: ChatSummary;
  active: boolean;
  renaming: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onStartRename: () => void;
  onFinishRename: (title: string | null) => void;
  onDelete: () => void;
}

function ChatRow({
  chat,
  active,
  renaming,
  menuOpen,
  onMenuOpenChange,
  onSelect,
  onStartRename,
  onFinishRename,
  onDelete,
}: RowProps) {
  return (
    <li
      className={cn(
        "group relative flex items-center rounded-lg",
        active ? "bg-card ring-1 ring-border" : "hover:bg-accent/60",
        menuOpen && !active && "bg-accent/60",
      )}
    >
      {renaming ? (
        <RenameInput initial={chat.title} onDone={onFinishRename} />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          title={chat.title}
          className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg pr-1 pl-2.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MessageSquare
            className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
          />
          <span className="truncate">{chat.title}</span>
        </button>
      )}

      {!renaming && (
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Options for ${chat.title}`}
              className={cn(
                "mr-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                active && "opacity-100",
              )}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40">
            <DropdownMenuItem onSelect={onStartRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/** Inline rename field: Enter or blur saves, Escape cancels. */
function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (title: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false); // blur fires after Enter/Escape unmounts us — only finish once
  const [value, setValue] = useState(initial);

  useEffect(() => {
    // wait a tick so the dropdown finishes returning focus to its trigger first
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    onDone(save ? value.trim() || null : null);
  }

  return (
    <input
      ref={ref}
      value={value}
      maxLength={80}
      aria-label="Chat name"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="mx-1 my-1 h-7 min-w-0 flex-1 rounded-md border border-primary bg-card px-2 text-sm ring-3 ring-ring/40 outline-none"
    />
  );
}
