import { useState, useRef, useEffect } from "react";
import { cn } from "@/ui/utils";

interface MakerMarkProps {
  className?: string;
}

export function MakerMark({ className }: MakerMarkProps) {
  const [revealed, setRevealed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setRevealed(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setRevealed(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "inline-flex items-center gap-2 select-none",
        className
      )}
      aria-label="Made by Alsesd"
    >
      <button
        type="button"
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-full font-serif text-sm font-semibold italic transition-colors",
          revealed ? "bg-primary text-primary-fg" : "text-text-muted hover:bg-surface-raised hover:text-primary",
        )}
        aria-label={revealed ? "Hide creator credit" : "Reveal creator credit"}
        aria-expanded={revealed}
        onClick={() => setRevealed((prev) => !prev)}
      >
        A.
      </button>

      <span
        className={cn(
          "inline-flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-out motion-reduce:transition-none",
          revealed
            ? "max-w-[200px] opacity-100 translate-x-0"
            : "max-w-0 opacity-0 -translate-x-2 pointer-events-none"
        )}
      >
        <span className="text-xs text-text-muted">
          made by
        </span>
        <span className="font-serif text-sm font-semibold italic text-primary">
          Alsesd
        </span>
      </span>
    </div>
  );
}
