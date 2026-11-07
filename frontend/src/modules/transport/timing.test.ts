import { describe, it, expect } from "vitest";
import { daysWord, orderTiming } from "./timing";

describe("order timing", () => {
  const today = "2026-11-07";
  it("is urgent today, then tomorrow, the day after and later", () => {
    expect(orderTiming(today, "submitted", today).kind).toBe("today");
    expect(orderTiming("2026-11-08", "accepted", today).kind).toBe("tomorrow");
    expect(orderTiming("2026-11-09", "accepted", today).kind).toBe("dayAfter");
    expect(orderTiming("2026-11-14", "accepted", today)).toEqual({ kind: "later", days: 7 });
  });
  it("calls a past open order unclosed and a past closed one past", () => {
    expect(orderTiming("2026-11-05", "accepted", today)).toEqual({ kind: "overdue", days: -2 });
    expect(orderTiming("2026-11-05", "done", today).kind).toBe("past");
  });
  it("crosses months and the daylight-saving change", () => {
    expect(orderTiming("2026-12-01", "submitted", "2026-11-30").kind).toBe("tomorrow");
    expect(orderTiming("2026-10-26", "submitted", "2026-10-24").kind).toBe("dayAfter");
  });
  it("speaks Ukrainian plurals", () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(daysWord)).toEqual(["1 день", "2 дні", "5 днів", "11 днів", "21 день", "22 дні", "25 днів"]);
  });
});
