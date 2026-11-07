import { useTheme, type Theme } from "@/platform/theme/ThemeContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { Sun, Moon, Laptop, Minus, Plus } from "lucide-react";
import { DEFAULT_UI_SCALE, UI_SCALES, stepUiScale } from "@/platform/theme/uiScale";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/ui/utils";

export function ThemeToggle({ className, placement = "down", showLabel = placement === "up" }: { className?: string; /** "up" at the bottom of the screen (sidebar footer). */ placement?: "down" | "up"; /** Show the current theme name next to the icon (default: in the sidebar only). */ showLabel?: boolean }) {
  const { theme, effectiveTheme, setTheme, scale, setScale } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: uk.nav.themeLight, icon: Sun },
    { value: "dark", label: uk.nav.themeDark, icon: Moon },
    { value: "system", label: uk.nav.themeSystem, icon: Laptop },
  ];

  const currentLabel = theme === "light" ? uk.nav.themeLight : theme === "dark" ? uk.nav.themeDark : uk.nav.themeSystem;

  return (
    <div className={cn("relative inline-block text-left", className)} ref={containerRef}>
      <button
        type="button"
        id="theme-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        title={`${uk.nav.appearance}: ${currentLabel}`}
        className={cn(
          "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-sm font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          showLabel ? "gap-2 px-3" : "px-2.5",
          isOpen && "bg-surface-raised text-text-main",
        )}
        aria-label={showLabel ? undefined : `${uk.nav.appearance}: ${currentLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {effectiveTheme === "dark" ? (
          <Moon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Sun className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        )}
        {showLabel && <span>{currentLabel}</span>}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="theme-toggle"
          className={cn("z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto", placement === "up" ? "absolute bottom-full left-0 mb-1.5 w-60 origin-bottom-left" : "fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-60 sm:origin-top-right", "rounded-control border border-border bg-surface py-1 shadow-overlay focus:outline-none")}
        >
          {options.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme(opt.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center px-3 py-2 text-sm text-left min-h-[44px] hover:bg-surface-raised transition-colors",
                  isSelected ? "font-semibold text-primary" : "text-text-main"
                )}
              >
                <Icon className="h-4 w-4 mr-2 opacity-70" aria-hidden="true" />
                {opt.label}
              </button>
            );
          })}
          <div className="mt-1 border-t border-border px-3 pb-1.5 pt-2" role="group" aria-label={uk.nav.uiScale}>
            <p className="text-xs text-text-muted">{uk.nav.uiScale}</p>
            <div className="mt-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setScale(stepUiScale(scale, -1))}
                disabled={scale === UI_SCALES[0]}
                aria-label={uk.nav.uiScaleSmaller}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border hover:bg-surface-raised disabled:opacity-40"
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setScale(DEFAULT_UI_SCALE)}
                aria-label={uk.nav.uiScaleReset}
                title={uk.nav.uiScaleReset}
                className="figure min-h-[44px] flex-1 rounded-control text-sm font-semibold text-text-main hover:bg-surface-raised"
              >
                <span aria-live="polite">{Math.round(scale * 100)}%</span>
              </button>
              <button
                type="button"
                onClick={() => setScale(stepUiScale(scale, 1))}
                disabled={scale === UI_SCALES[UI_SCALES.length - 1]}
                aria-label={uk.nav.uiScaleLarger}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border hover:bg-surface-raised disabled:opacity-40"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
