import { ChevronRight } from "lucide-react";
import { HiOutlinePresentationChartBar } from "react-icons/hi";
import { cn } from "@/lib/utils";

interface Props {
  version: number;
  slideCount: number;
  active?: boolean;
  onClick: () => void;
}

/** The "Deck vN · K slides" box shown under an assistant reply; opens that version in the previewer. */
export function DeckChip({ version, slideCount, active, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full max-w-[340px] items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition outline-none hover:border-primary hover:bg-primary-soft focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "border-primary bg-primary-soft",
      )}
    >
      <span className="grid aspect-video w-11 shrink-0 place-items-center rounded-md bg-gradient-to-br from-indigo-900 to-indigo-600 text-white">
        <HiOutlinePresentationChartBar className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <b className="block font-semibold">Deck v{version}</b>
        <small className="text-xs text-muted-foreground">
          {slideCount} {slideCount === 1 ? "slide" : "slides"}
        </small>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
