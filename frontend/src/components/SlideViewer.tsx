import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeckVersionDto } from "@/types";

interface Props {
  deck?: DeckVersionDto;
  building: boolean;
}

export function SlideViewer({ deck, building }: Props) {
  const [current, setCurrent] = useState(0);
  const slides = deck?.slides ?? [];

  useEffect(() => {
    setCurrent(0);
  }, [deck?.id]);

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b px-4 py-3 text-sm font-semibold">
        <span>Preview{deck ? ` — v${deck.version}` : ""}</span>
        <div className="flex items-center gap-2">
          {building && (
            <Badge variant="secondary" className="animate-pulse">
              building…
            </Badge>
          )}
          {slides.length > 0 && (
            <Badge variant="secondary">
              {current + 1} / {slides.length}
            </Badge>
          )}
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-hidden p-6">
        {slides.length > 0 ? (
          <img
            src={slides[current]?.imageUrl}
            alt={`Slide ${current + 1}`}
            className={`max-h-full max-w-full rounded-lg border shadow-sm transition-opacity ${
              building ? "opacity-40" : ""
            }`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {building ? "Building your first slides…" : "No slides yet."}
          </p>
        )}
      </div>

      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-3 border-t py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            disabled={current === 0}
          >
            <ChevronLeft /> Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrent((c) => Math.min(slides.length - 1, c + 1))}
            disabled={current === slides.length - 1}
          >
            Next <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
