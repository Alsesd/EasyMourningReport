import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminSummaryPage from "./AdminSummaryPage";
import type { SummaryDTO } from "@/platform/api/types";

const mockSummary: SummaryDTO = {
  period: "2026-10",
  submitted_only: false,
  stores: [
    { id: 1, name: "Магазин Центр", archived: false, calculation_enabled: true },
    { id: 2, name: "Магазин Вокзал", archived: false, calculation_enabled: false },
  ],
  rows: [
    {
      name: "Свічка поминальна",
      note: "",
      price_cents: 2500,
      label: "",
      cells: [10, 5],
      calculation_cells: [3, 0],
      quantity: 15,
      calculation_quantity: 3,
      sum_cents: 37500,
    },
    {
      name: "Хустка шовкова",
      note: "акція",
      price_cents: 5000,
      label: "",
      cells: [2, 0],
      calculation_cells: [0, 0],
      quantity: 2,
      calculation_quantity: 0,
      sum_cents: 10000,
    },
  ],
  store_totals_cents: [35000, 12500],
  grand_total_cents: 47500,
};

describe("AdminSummaryPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["adminSummary", "2026-10", false], mockSummary);

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/admin/reports")) {
        // A draft with amounts and a submitted report: only the latter counts as submitted.
        const reports = [
          { store_id: 1, store_name: "Магазин Центр", store_archived: false, report_id: 1, period: "2026-10", status: "draft", total_cents: 5000, item_count: 2 },
          { store_id: 2, store_name: "Магазин Вокзал", store_archived: false, report_id: 2, period: "2026-10", status: "submitted", total_cents: 0, item_count: 0 },
          { store_id: 3, store_name: "Магазин Парк", store_archived: false, report_id: null, period: "2026-10", status: "none", total_cents: 0, item_count: 0 },
        ];
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reports) });
      }
      if (url.includes("/api/v1/admin/summary")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSummary),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
  });

  function renderPage(initialEntries = ["/admin/summary?period=2026-10"]) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <AdminSummaryPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("renders summary title, KPI cards, and matrix table", async () => {
    renderPage();
    expect(await screen.findByText("Зведений звіт")).toBeDefined();
    expect(screen.getByText("Магазин Центр")).toBeDefined();
    expect(screen.getByText("Магазин Вокзал")).toBeDefined();
    expect(screen.getByText("Свічка поминальна")).toBeDefined();
    expect(screen.getByText("Хустка шовкова")).toBeDefined();
    expect(screen.getByText("Загальний підсумок")).toBeDefined();
  });

  it("counts submitted reports by status, not by amounts", async () => {
    renderPage();
    const card = (await screen.findByText("Надіслано звітів")).closest("div.rounded-card") as HTMLElement;
    expect(await within(card).findByText("1 / 3")).toBeDefined();
  });

  it("has excel download link with correct search params", async () => {
    renderPage();
    const link = screen.getByRole("link", { name: /Завантажити Excel/i });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toContain("/admin/summary.xlsx?period=2026-10");
  });

  it("toggles submitted-only checkbox", async () => {
    renderPage();
    const checkbox = screen.getByLabelText(/Лише надіслані/i);
    expect(checkbox).toBeDefined();
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });
});
