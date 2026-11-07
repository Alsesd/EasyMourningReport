import React, { createContext, useContext, useEffect, useState } from "react";
import { applyUiScale, readUiScale, storeUiScale } from "./uiScale";

export type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  effectiveTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  /** Interface scale of this device (1 = default), see uiScale.ts. */
  scale: number;
  setScale: (scale: number) => void;
}

const STORAGE_KEY = "easyMourningReport.theme";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") {
        return stored;
      }
    } catch {
      // Ignore localStorage errors
    }
    return "system";
  });

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const [scale, setScaleState] = useState<number>(readUiScale);
  useEffect(() => applyUiScale(scale), [scale]);
  const setScale = (next: number) => {
    setScaleState(next);
    storeUiScale(next);
  };

  const effectiveTheme = theme === "system" ? (systemIsDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = effectiveTheme;
    if (effectiveTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    const meta = document.getElementById("theme-color-meta") || document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", effectiveTheme === "dark" ? "#121918" : "#FCFCFA");
    }
  }, [effectiveTheme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore localStorage errors
    }
  };

  const toggleTheme = () => {
    setTheme(effectiveTheme === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, effectiveTheme, setTheme, toggleTheme, scale, setScale }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
