import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReportsMonthPage from "./ReportsMonthPage";
import type { AdminReportListItemDTO, DailyReportListItemDTO, SummaryDTO } from "@/platform/api/types";

const reports: AdminReportListItemDTO[] = [
  // A draft with amounts and a submitted report: only the latter counts as submitted.
  { store_id: 1, store_name: "Магазин Центр", store_archived: false, report_id: 101, period: "2026-10", status: "draft", total_cents: 35000, item_count: 5 },
  { store_id: 2, store_name: "Магазин Вокзал", store_archived: false, report_id: 102, period: "2026-10", status: "submitted", total_cents: 12500, item_count: 2 },
  { store_id: 3, store_name: "Магазин Північ", store_archived: true, report_id: null, period: "2026-10", status: "none", total_cents: 0, item_count: 0 },
];

const summary: SummaryDTO = {
  period: "2026-10",
  submitted_only: false,
  stores: [
    { id: 1, name: "Магазин Центр", archived: false, calculation_enabled: true },
    { id: 2, name: "Магазин Вокзал", archived: false, calculation_enabled: false },
  ],
  rows: [
    { name: "Свічка поминальна", note: "", price_cents: 2500, label: "", cells: [10, 5], calculation_cells: [3, 0], quantity: 15, calculation_quantity: 3, sum_cents: 37500 },
    { name: "Хустка шовкова", note: "акція", price_cents: 5000, label: "", cells: [2, 0], calculation_cells: [0, 0], quantity: 2, calculation_quantity: 0, sum_cents: 10000 },
  ],
  store_totals_cents: [35000, 12500],
  grand_total_cents: 47500,
};

const daily: DailyReportListItemDTO[] = [
  { store_id: 1, store_name: "Магазин Центр", store_archived: false, report_id: 101, day: "2026-10-05", status: "submitted", total_cents: 4000, item_count: 1 },
  { store_id: 2, store_name: "Магазин Вокзал", store_archived: false, report_id: 102, day: "2026-10-05", status: "none", total_cents: 0, item_count: 0 },
];

describe("ReportsMonthPage", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const body = url.includes("/api/v1/admin/summary") ? summary : url.includes("/api/v1/admin/daily-reports") ? daily : reports;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });
  });

  function renderPage(entry = "/admin/reports?period=2026-10&tab=month") {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <ReportsMonthPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("titles the page with the month and counts submitted reports by status", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Жовтень 2026" })).toBeDefined();
    expect(await screen.findByText("Надіслано 1 з 3, без звіту: 1")).toBeDefined();
  });

  it("lists every store with its state and links to existing reports", async () => {
    renderPage();
    const stores = screen.getByRole("region", { name: "Підрозділи" });
    await within(stores).findAllByText("Магазин Центр");
    expect(within(stores).getAllByText("Чернетка").length).toBeGreaterThan(0);
    expect(within(stores).getAllByText("Немає звіту").length).toBeGreaterThan(0);
    const links = within(stores).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(links).toEqual(["/admin/reports/101", "/admin/reports/102"]);
  });

  it("shows the products matrix with the grand total", async () => {
    renderPage();
    const products = await screen.findByRole("region", { name: "Товари за місяць" });
    expect((await within(products).findAllByText("Свічка поминальна")).length).toBeGreaterThan(0);
    expect(within(products).getAllByText("Загальний підсумок").length).toBeGreaterThan(0);
  });

  it("links the Excel export to the month and the submitted-only filter", async () => {
    renderPage();
    const link = screen.getByRole("link", { name: /Завантажити Excel/ });
    expect(link.getAttribute("href")).toContain("/admin/summary.xlsx?period=2026-10");
    fireEvent.click(screen.getByRole("switch", { name: "Лише надіслані" }));
    expect(screen.getByRole("link", { name: /Завантажити Excel/ }).getAttribute("href")).toContain("submitted_only=true");
  });

  it("narrows the register, the matrix and the Excel export to one day", async () => {
    renderPage("/admin/reports?period=2026-10&day=2026-10-05");
    expect(screen.getByRole("tab", { name: "За день" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: /5 жовтня 2026/ })).toBeDefined();
    expect(await screen.findByText("Надіслано 1 з 2, без звіту: 1")).toBeDefined();
    const stores = screen.getByRole("region", { name: "Підрозділи" });
    expect(within(stores).getAllByText("день не заповнено").length).toBeGreaterThan(0);
    const links = within(stores).getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(links).toEqual(["/admin/reports/101?day=2026-10-05", "/admin/reports/102?day=2026-10-05"]);
    expect(screen.getByRole("region", { name: "Товари за день" })).toBeDefined();
    expect(screen.getByRole("link", { name: /Завантажити Excel/ }).getAttribute("href")).toContain("summary.xlsx?day=2026-10-05");
    const calls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(calls.some((u) => u.includes("/api/v1/admin/summary?day=2026-10-05"))).toBe(true);
    expect((screen.getByRole("combobox", { name: "День для перегляду" }) as HTMLSelectElement).value).toBe("2026-10-05");
  });

  it("opens on the day tab and switches to the read-only month tab", async () => {
    renderPage("/admin/reports?period=2026-10");
    expect(screen.getByRole("tab", { name: "За день" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("region", { name: "Товари за день" })).toBeDefined();
    // A past month opens on its last day.
    expect((screen.getByRole("combobox", { name: "День для перегляду" }) as HTMLSelectElement).value).toBe("2026-10-31");
    fireEvent.click(screen.getByRole("tab", { name: "За місяць" }));
    expect(await screen.findByRole("region", { name: "Товари за місяць" })).toBeDefined();
    expect(screen.getByText(/Лише перегляд/)).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "День для перегляду" })).toBeNull();
  });
});
