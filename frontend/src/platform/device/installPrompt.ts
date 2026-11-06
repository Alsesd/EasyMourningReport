/**
 * Installing the app on the device. Chrome-family browsers fire `beforeinstallprompt` once, possibly before React
 * has mounted, so it is captured at start-up and kept here until the person agrees. The browser always shows its
 * own confirmation after `prompt()`: installation is never silent. Safari on iPhone has no such API (Share, then
 * "Add to Home Screen").
 */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function captureInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export const subscribeInstall = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export const canPromptInstall = (): boolean => deferred !== null;

export function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** iPhone/iPad Safari in a normal tab: the app can be added to the Home Screen by hand only. */
export function isIosTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && !isStandalone();
}

/** Must be called straight from a click handler. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const ev = deferred;
  if (!ev) return "unavailable";
  deferred = null; // an event can be used once
  notify();
  await ev.prompt();
  return (await ev.userChoice).outcome;
}
