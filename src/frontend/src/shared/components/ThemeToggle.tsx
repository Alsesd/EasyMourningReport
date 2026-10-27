import { useTheme, type Theme } from "@/shared/context/ThemeContext";
import { uk } from "@/shared/i18n/uk";
import { Sun, Moon, Laptop } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/shared/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, effectiveTheme, setTheme } = useTheme();
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
        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-control border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-main hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        aria-label={effectiveTheme === "light" ? "Вимкнути світлу тему" : "Увімкнути світлу тему"}
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
          className="absolute right-0 mt-1.5 w-40 origin-top-right rounded-control border border-border bg-surface py-1 shadow-lg z-50 focus:outline-none"
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
                  "w-full flex items-center px-3 py-2 text-xs text-left min-h-[44px] hover:bg-page transition-colors",
                  isSelected ? "font-semibold text-primary" : "text-text-main"
                )}
              >
                <Icon className="h-4 w-4 mr-2 opacity-70" aria-hidden="true" />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
