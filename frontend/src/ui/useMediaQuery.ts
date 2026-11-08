import { useSyncExternalStore } from "react";

/** Tracks a CSS media query. Without `matchMedia` (tests, very old browsers) it reports `fallback`. */
export function useMediaQuery(query: string, fallback = true): boolean {
  const subscribe = (notify: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
    const mql = window.matchMedia(query);
    mql.addEventListener("change", notify);
    return () => mql.removeEventListener("change", notify);
  };
  const snapshot = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback);
  return useSyncExternalStore(subscribe, snapshot, () => fallback);
}

/** True from the `sm` breakpoint up: dialogs are centred modals there and bottom sheets below it. */
export const useIsWide = () => useMediaQuery("(min-width: 640px)");
