import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { HiOutlinePresentationChartBar } from "react-icons/hi";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DeckVersionDto } from "@/types";

interface Props {
  deck?: DeckVersionDto;
  title: string;
  building: boolean;
}

export function SlideViewer({ deck, title, building }: Props) {
  const [current, setCurrent] = useState(0);
  const slides = deck?.slides ?? [];
  const last = slides.length - 1;

  // back to slide 1 whenever a different deck version is shown
  useEffect(() => {
    setCurrent(0);
  }, [deck?.id]);

  // ← / → move between slides (unless the user is typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t?.isContentEditable) return;
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(last, c + 1));
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [last]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-card px-4">
        <h2 className="min-w-0 truncate text-sm font-semibold">{deck ? title : "Preview"}</h2>
        {deck && (
          <Badge className="bg-primary-soft text-primary hover:bg-primary-soft">v{deck.version}</Badge>
        )}
        {building && (
          <Badge variant="secondary" className="animate-pulse">
            building…
          </Badge>
        )}
        <div className="ml-auto flex shrink-0 gap-2">
          <DownloadButton href={deck?.pptxUrl} label="PPTX" />
          <DownloadButton href={deck?.pdfUrl} label="PDF" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-7 max-md:p-4">
        {slides.length > 0 ? (
          <img
            key={slides[current]?.imageUrl}
            src={slides[current]?.imageUrl}
            alt={`Slide ${current + 1} of ${slides.length}`}
            className={cn(
              "max-h-full max-w-full rounded-xl bg-white object-contain shadow-lg ring-1 ring-black/5 transition-opacity",
              building && "opacity-40",
            )}
          />
        ) : (
          <div className="text-center text-muted-foreground">
            <div className="mx-auto mb-4 grid aspect-video w-[min(70%,460px)] place-items-center rounded-2xl border-2 border-dashed">
              <HiOutlinePresentationChartBar className="size-8 opacity-60" />
            </div>
            <h3 className="mb-1 text-[15px] font-medium text-foreground">
              {building ? "Building your slides…" : "No slides yet"}
            </h3>
            <p className="text-sm">
              {building ? "This usually takes a few seconds." : "Your deck will appear here once it's built."}
            </p>
          </div>
        )}
      </div>

      <nav aria-label="Slide navigation" className="flex shrink-0 items-center justify-center gap-3.5 px-4 pt-3 pb-4">
        <Button
          variant="outline"
          onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          disabled={slides.length === 0 || current === 0}
          className="h-8 bg-card"
        >
          <ChevronLeft /> <span className="max-md:hidden">Previous</span>
        </Button>

        <div className="flex items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.index}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === current ? "true" : undefined}
              onClick={() => setCurrent(i)}
              className={cn(
                "h-[7px] rounded-full transition-all",
                i === current ? "w-5 bg-primary" : "w-[7px] bg-border hover:bg-muted-foreground",
              )}
            />
          ))}
        </div>

        <span className="min-w-12 text-center text-[13px] text-muted-foreground tabular-nums">
          {slides.length > 0 ? `${current + 1} / ${slides.length}` : ""}
        </span>

        <Button
          variant="outline"
          onClick={() => setCurrent((c) => Math.min(last, c + 1))}
          disabled={slides.length === 0 || current === last}
          className="h-8 bg-card"
        >
          <span className="max-md:hidden">Next</span> <ChevronRight />
        </Button>
      </nav>
    </div>
  );
}

function DownloadButton({ href, label }: { href?: string; label: string }) {
  if (!href) {
    return (
      <Button variant="outline" disabled className="h-8 bg-card">
        <Download /> {label}
      </Button>
    );
  }
  return (
    <Button variant="outline" asChild className="h-8 bg-card">
      <a href={href}>
        <Download /> {label}
      </a>
    </Button>
  );
}
