/**
 * Offline and local draft storage for Store Report.
 */

export interface SavedDraft {
  period: string;
  storeId?: number;
  timestamp: number;
  quantities: Record<string, number>; // key: `${productId}_${priceCents}` -> quantity
  /** The server revision the changes were made on; a draft on an older revision must not be restored over a
   * colleague's newer save. */
  revision?: number;
}

function getDraftKey(period: string, storeId?: number): string {
  return `easyMourningReport.draft.${storeId || "current"}.${period}`;
}

export function saveLocalDraft(period: string, quantities: Record<string, number>, storeId?: number, revision?: number): void {
  try {
    const draft: SavedDraft = {
      period,
      storeId,
      timestamp: Date.now(),
      quantities,
      revision,
    };
    localStorage.setItem(getDraftKey(period, storeId), JSON.stringify(draft));
  } catch (err) {
    console.warn("Failed to persist local draft to localStorage", err);
  }
}

export function loadLocalDraft(period: string, storeId?: number): SavedDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(period, storeId));
    if (!raw) return null;
    return JSON.parse(raw) as SavedDraft;
  } catch {
    return null;
  }
}

export function clearLocalDraft(period: string, storeId?: number): void {
  try {
    localStorage.removeItem(getDraftKey(period, storeId));
  } catch {
    // Ignore
  }
}
