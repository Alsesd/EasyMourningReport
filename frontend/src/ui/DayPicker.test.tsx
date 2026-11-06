import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DayPicker, dayOptions } from "./DayPicker";
import { TimeField, maskTime, isValidTime } from "./TimeField";
import { formatDayReadable, shiftDay } from "@/platform/i18n";

const labels = { previous: "Попередній день", next: "Наступний день", day: "День", today: "Сьогодні" };

describe("day helpers", () => {
  it("shifts across month and year ends", () => {
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("formats in Ukrainian", () => {
    expect(formatDayReadable("2026-11-06")).toMatch(/листопада/);
  });
  it("offers a window around today and always the selected day", () => {
    const options = dayOptions("2031-01-01", "2026-11-06");
    expect(options).toContain("2026-11-06");
    expect(options).toContain("2031-01-01");
    expect(options[0] < "2026-11-06").toBe(true);
  });
});

describe("DayPicker", () => {
  it("steps one day with the arrows", () => {
    const onChange = vi.fn();
    render(<DayPicker value="2026-11-06" onChange={onChange} labels={labels} />);
    fireEvent.click(screen.getByRole("button", { name: "Наступний день" }));
    fireEvent.click(screen.getByRole("button", { name: "Попередній день" }));
    expect(onChange).toHaveBeenNthCalledWith(1, "2026-11-07");
    expect(onChange).toHaveBeenNthCalledWith(2, "2026-11-05");
  });
});

describe("TimeField", () => {
  it("masks input as 24-hour time", () => {
    expect(maskTime("0930")).toBe("09:30");
    expect(maskTime("09:3")).toBe("09:3");
    expect(maskTime("ab12cd345")).toBe("12:34");
    expect(isValidTime("09:30")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
  });
  it("reports masked values", () => {
    const onChange = vi.fn();
    render(<TimeField value="" onChange={onChange} aria-label="Час" />);
    fireEvent.change(screen.getByLabelText("Час"), { target: { value: "1445" } });
    expect(onChange).toHaveBeenCalledWith("14:45");
  });
});
