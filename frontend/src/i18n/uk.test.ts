import { describe, it, expect } from "vitest";
import { formatMoney, formatCurrency, parseCents, shiftPeriod, formatPeriodReadable } from "./uk";

describe("Ukrainian formatting utilities", () => {
  it("formats money correctly from cents", () => {
    expect(formatMoney(0)).toBe("0.00");
    expect(formatMoney(2500)).toBe("25.00");
    expect(formatMoney(125)).toBe("1.25");
    expect(formatMoney(10)).toBe("0.10");
  });

  it("formats currency with hryvnia symbol", () => {
    expect(formatCurrency(2500)).toBe("25.00 ₴");
  });

  it("parses cents from strings and numbers", () => {
    expect(parseCents("25.00")).toBe(2500);
    expect(parseCents("25,50")).toBe(2550);
    expect(parseCents(" 10.5 ")).toBe(1050);
    expect(parseCents(5000)).toBe(5000);
  });

  it("shifts periods forward and backward", () => {
    expect(shiftPeriod("2026-10", 1)).toBe("2026-11");
    expect(shiftPeriod("2026-10", -1)).toBe("2026-09");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
  });

  it("formats readable period", () => {
    expect(formatPeriodReadable("2026-10")).toBe("Жовтень 2026");
  });
});
