import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BarSeries, RankedRows, Tiles, labelStep } from "./blocks";
import { formatDashValue } from "@/modules/management/format";

describe("dashboard blocks", () => {
  it("formats every unit the server sends", () => {
    expect(formatDashValue("money_cents", 372650)).toBe("3\u00a0726,50\u00a0₴");
    expect(formatDashValue("percent", 66.6)).toBe("67\u00a0%");
    expect(formatDashValue("minutes", 12)).toBe("12 хв");
    expect(formatDashValue("minutes", 125)).toBe("2 год 5 хв");
    expect(formatDashValue("count", 1234)).toBe("1\u00a0234");
  });

  it("shows tiles with their hint and marks an alert", () => {
    render(
      <Tiles
        tiles={[
          { label: "Виручка", value: 150000, unit: "money_cents", hint: "надіслані звіти", tone: "" },
          { label: "Незакриті", value: 3, unit: "count", hint: "", tone: "alert" },
        ]}
      />,
    );
    expect(screen.getByText("1 500,00 ₴")).toBeDefined();
    expect(screen.getByText("надіслані звіти")).toBeDefined();
    expect(screen.getByText("3").className).toContain("text-destructive");
  });

  it("draws bars with every value readable as text and the unfinished month marked", () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ label: `м${i + 1}`, value: i === 3 ? 500000 : i * 1000, partial: i === 11 }));
    render(<BarSeries series={{ title: "Виручка за 12 місяців", unit: "money_cents", note: "Поточний місяць ще не завершено.", points }} />);
    const bars = screen.getByRole("list", { name: "Виручка за 12 місяців" });
    expect(within(bars).getAllByRole("listitem")).toHaveLength(12);
    expect(within(bars).getAllByRole("listitem")[11].getAttribute("title")).toContain("місяць ще не завершено");
    // The biggest and the last value are printed on the chart; all of them sit in the table.
    expect(screen.getAllByText("5 000,00 ₴").length).toBeGreaterThan(0);
    expect(screen.getByText("Усі значення таблицею")).toBeDefined();
    expect(screen.getByText("м12 *")).toBeDefined();
  });

  it("says so when a series has no data, and prints fewer x labels for long series", () => {
    render(<BarSeries series={{ title: "Порожньо", unit: "count", note: "", points: [{ label: "1", value: 0, partial: false }] }} />);
    expect(screen.getByText("Даних за цей період немає.")).toBeDefined();
    expect(labelStep(12)).toBe(1);
    expect(labelStep(30)).toBe(5);
  });

  it("ranks list rows with their hint", () => {
    render(<RankedRows list={{ title: "По підрозділах", unit: "count", rows: [{ label: "Філія А", value: 7, hint: "виконано 5" }, { label: "Філія Б", value: 2, hint: "" }] }} />);
    expect(screen.getByText("Філія А")).toBeDefined();
    expect(screen.getByText("виконано 5")).toBeDefined();
  });
});
