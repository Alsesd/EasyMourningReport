import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminSummaryPage from "./AdminSummaryPage";
import type { SummaryDTO } from "@/api/types";

const mockSummary: SummaryDTO = {
  period: "2026-10",
  submitted_only: false,
  stores: [
    { id: 1, name: "Магазин Центр", archived: false },
    { id: 2, name: "Магазин Вокзал", archived: false },
  ],
  rows: [
    {
      name: "Свічка поминальна",
      note: "",
      price_cents: 2500,
      label: "",
      cells: [10, 5],
      quantity: 15,
      sum_cents: 37500,
    },
    {
      name: "Хустка шовкова",
      note: "акція",
      price_cents: 5000,
      label: "",
      cells: [2, 0],
      quantity: 2,
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
