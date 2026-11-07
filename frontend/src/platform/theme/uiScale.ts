/**
 * Interface scale (text and everything sized in rem), chosen per device: one desk finds the default too big,
 * another needs it larger. Stored in localStorage like the theme and applied to the root font size, so every
 * rem-based size follows; the 44px touch-target floors stay in px on purpose.
 */

export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6] as const;
export const DEFAULT_UI_SCALE = 1;

const STORAGE_KEY = "easyMourningReport.uiScale";

export function readUiScale(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    if ((UI_SCALES as readonly number[]).includes(n)) return n;
  } catch {
    // Storage blocked: the default scale.
  }
  return DEFAULT_UI_SCALE;
}

export function applyUiScale(scale: number): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = scale === DEFAULT_UI_SCALE ? "" : `${Math.round(scale * 100)}%`;
}

export function storeUiScale(scale: number): void {
  try {
    if (scale === DEFAULT_UI_SCALE) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
}

/** The neighbouring scale step (dir -1 smaller, +1 larger), or the same scale at either end. */
export function stepUiScale(scale: number, dir: -1 | 1): number {
  const list = UI_SCALES as readonly number[];
  const i = list.indexOf(scale);
  const at = i < 0 ? list.indexOf(DEFAULT_UI_SCALE) : i;
  return list[Math.min(list.length - 1, Math.max(0, at + dir))];
}
