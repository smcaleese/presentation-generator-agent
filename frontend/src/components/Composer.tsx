import { ArrowUp } from "lucide-react";
import { useLayoutEffect } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Roomy message box: auto-growing textarea, hint + send button inside the rounded frame.
 * The focus ring is drawn on the frame only — the textarea itself has none.
 */
export function Composer({ value, onChange, onSubmit, disabled, placeholder, textareaRef }: Props) {
  // grow with the content (CSS min/max-height clamp it)
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, textareaRef]);

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className="shrink-0 px-5 pt-2 pb-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSubmit();
        }}
        className="mx-auto flex max-w-[720px] flex-col gap-2 rounded-[22px] border bg-card py-4 pr-3.5 pl-5 shadow-xs transition focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/40"
      >
        <textarea
          ref={textareaRef}
          value={value}
          rows={2}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          className="max-h-[200px] min-h-14 w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground focus:outline-none focus-visible:ring-0 disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-muted-foreground max-md:hidden">
            Enter to send · Shift+Enter for a new line
          </span>
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="ml-auto grid size-[42px] shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
