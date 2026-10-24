import { describe, it, expect, beforeEach } from "vitest";
import { saveLocalDraft, loadLocalDraft, clearLocalDraft } from "./offlineDrafts";

describe("offlineDrafts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and retrieves a draft for a period and store", () => {
    const quantities = { "101_2500": 3, "102_3000": 5 };
    saveLocalDraft("2026-10", quantities, 42);

    const loaded = loadLocalDraft("2026-10", 42);
    expect(loaded).toBeDefined();
    expect(loaded?.period).toBe("2026-10");
    expect(loaded?.storeId).toBe(42);
    expect(loaded?.quantities).toEqual(quantities);
  });

  it("clears a saved draft", () => {
    saveLocalDraft("2026-10", { "1_100": 1 }, 42);
    expect(loadLocalDraft("2026-10", 42)).not.toBeNull();

    clearLocalDraft("2026-10", 42);
    expect(loadLocalDraft("2026-10", 42)).toBeNull();
  });

  it("returns null for non-existent draft", () => {
    expect(loadLocalDraft("2020-01", 999)).toBeNull();
  });
});
