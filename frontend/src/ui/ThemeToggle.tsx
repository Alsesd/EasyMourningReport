import { useTheme, type Theme } from "@/platform/theme/ThemeContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { Sun, Moon, Laptop, Minus, Plus } from "lucide-react";
import { DEFAULT_UI_SCALE, UI_SCALES, stepUiScale } from "@/platform/theme/uiScale";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/ui/utils";

export function ThemeToggle({ className, placement = "down" }: { className?: string; /** "up" at the bottom of the screen (sidebar footer). */ placement?: "down" | "up" }) {
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

  return (
    <div className={cn("relative inline-block text-left", className)} ref={containerRef}>
      <button
        type="button"
        id="theme-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-control border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-main hover:bg-surface-raised transition-colors"
        aria-label={uk.nav.appearance}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {effectiveTheme === "dark" ? (
          <Moon className="h-4 w-4 mr-1.5 text-text-muted" aria-hidden="true" />
        ) : (
          <Sun className="h-4 w-4 mr-1.5 text-text-muted" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">
          {theme === "light" ? uk.nav.themeLight : theme === "dark" ? uk.nav.themeDark : uk.nav.themeSystem}
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="theme-toggle"
          className={cn("absolute w-60 z-50", placement === "up" ? "bottom-full left-0 mb-1.5 origin-bottom-left" : "right-0 mt-1.5 origin-top-right", "rounded-control border border-border bg-surface py-1 shadow-overlay focus:outline-none")}
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
                  "w-full flex items-center px-3 py-2 text-xs text-left min-h-[44px] hover:bg-surface-raised transition-colors",
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
