/** One automatic dialog at a time (biometric offer, device setup): the others wait for the slot instead of stacking. */

import { useEffect, useState } from "react";

let owner: symbol | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** `wanted` says the component wants to open its dialog; the result says it may. Releasing happens when it stops wanting. */
export function useDialogSlot(wanted: boolean): boolean {
  const [id] = useState(() => Symbol("dialog"));
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    if (wanted && owner === null) {
      owner = id;
      notify();
    }
    if (!wanted && owner === id) {
      owner = null;
      notify();
    }
  });
  useEffect(
    () => () => {
      if (owner === id) {
        owner = null;
        notify();
      }
    },
    [id],
  );
  return wanted && owner === id;
}
