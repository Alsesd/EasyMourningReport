import { useState, useRef, useEffect } from "react";
import { cn } from "@/shared/lib/utils";

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
        "maker-mark inline-flex items-center gap-1.5 opacity-70 hover:opacity-100 transition-opacity select-none",
        revealed && "is-revealed opacity-100",
        className
      )}
      aria-label="Made by Alsesd"
    >
      <button
        type="button"
        className="maker-mark-trigger inline-flex items-center justify-center w-[26px] h-[26px] min-h-[26px] min-w-[26px] rounded-lg border border-primary/50 bg-surface/80 hover:bg-surface text-primary font-bold text-xs tracking-tighter hover:rounded-full hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer shadow-2xs"
        aria-label={revealed ? "Hide creator credit" : "Reveal creator credit"}
        aria-expanded={revealed}
        onClick={() => setRevealed((prev) => !prev)}
      >
        A.
      </button>

      <span
        className={cn(
          "maker-mark-credit inline-flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap transition-all duration-300 ease-out",
          revealed
            ? "max-w-[200px] opacity-100 translate-x-0"
            : "max-w-0 opacity-0 -translate-x-2 pointer-events-none"
        )}
      >
        <span className="maker-mark-label text-[10px] font-semibold text-text-muted uppercase tracking-widest">
          made by
        </span>
        <span className="maker-mark-name text-xs font-bold text-primary tracking-wide">
          Alsesd
        </span>
      </span>
    </div>
  );
}
