import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminReportDetailPage from "./AdminReportDetailPage";
import type { AdminReportDetailDTO } from "@/platform/api/types";

const mockDetail: AdminReportDetailDTO = {
  report_id: 101,
  store_id: 1,
  store_name: "Магазин Центр",
  store_archived: false,
  period: "2026-10",
  status: "submitted",
  total_cents: 35000,
  item_count: 2,
  rows: [
    {
      id: 10,
      name: "Свічка поминальна",
      repriced: false,
      sum_cents: 25000,
      inputs: [
        {
          price_cents: 2500,
          quantity: 10,
          label: "",
          sum_cents: 25000,
        },
      ],
    },
    {
      id: 11,
      name: "Лампадка скляна",
      repriced: true,
      sum_cents: 10000,
      inputs: [
        {
          price_cents: 5000,
          quantity: 2,
          label: "new",
          sum_cents: 10000,
        },
      ],
    },
  ],
  inactive_rows: [
    {
      name: "Старий вінок",
      archived: true,
      lines: "1 × 50.00",
      sum_cents: 5000,
    },
  ],
  inactive_total_cents: 5000,
};

describe("AdminReportDetailPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["adminReportDetail", "101"], mockDetail);

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/admin/reports/101") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ...mockDetail, status: "draft" }),
        });
      }
      if (url.includes("/api/v1/admin/reports/101")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockDetail),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
  });

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/admin/reports/101"]}>
          <Routes>
            <Route path="/admin/reports/:reportId" element={<AdminReportDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("renders store name, items with labels, inactive section and grand total", async () => {
    renderPage();
    expect(await screen.findByText("Магазин Центр")).toBeDefined();
    expect(screen.getByText("Свічка поминальна")).toBeDefined();
    expect(screen.getByText("Лампадка скляна")).toBeDefined();
    expect(screen.getByText("нова ціна")).toBeDefined();
    expect(screen.getByText("Старий вінок")).toBeDefined();
    expect(screen.getByText("Розблокувати звіт")).toBeDefined();
  });

  it("opens unlock confirmation dialog and toggles status", async () => {
    renderPage();
    await screen.findByText("Магазин Центр");

    const unlockBtn = screen.getByRole("button", { name: /Розблокувати звіт/i });
    fireEvent.click(unlockBtn);

    // Dialog appears
    expect(await screen.findByText("Розблокувати звіт?")).toBeDefined();

    const confirmBtns = screen.getAllByRole("button", { name: /Розблокувати звіт/i });
    // Click the confirm button in the dialog
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/Звіт розблоковано/i)).toBeDefined();
    });
  });
});
