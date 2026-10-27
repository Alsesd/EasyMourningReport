import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminReportsPage from "./AdminReportsPage";
import type { AdminReportListItemDTO } from "@/shared/api/types";

const mockReports: AdminReportListItemDTO[] = [
  {
    store_id: 1,
    store_name: "Магазин Центр",
    store_archived: false,
    report_id: 101,
    period: "2026-10",
    status: "submitted",
    total_cents: 35000,
    item_count: 5,
  },
  {
    store_id: 2,
    store_name: "Магазин Вокзал",
    store_archived: false,
    report_id: 102,
    period: "2026-10",
    status: "draft",
    total_cents: 12500,
    item_count: 2,
  },
  {
    store_id: 3,
    store_name: "Магазин Північ (Архів)",
    store_archived: true,
    report_id: null,
    period: "2026-10",
    status: "none",
    total_cents: 0,
    item_count: 0,
  },
];

describe("AdminReportsPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["adminReports", "2026-10"], mockReports);

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/admin/reports")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockReports),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
  });

  function renderPage(initialEntries = ["/admin/reports?period=2026-10"]) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <AdminReportsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("renders reports list with status pills and totals", async () => {
    renderPage();
    expect(await screen.findByText("Звіти магазинів")).toBeDefined();
    expect(screen.getByText("Магазин Центр")).toBeDefined();
    expect(screen.getByText("Магазин Вокзал")).toBeDefined();
    expect(screen.getByText("Магазин Північ (Архів)")).toBeDefined();

    expect(screen.getByText("Надіслано")).toBeDefined();
    expect(screen.getByText("Чернетка")).toBeDefined();
    expect(screen.getByText("Немає звіту")).toBeDefined();
  });

  it("renders link to report detail for stores with report_id", async () => {
    renderPage();
    await screen.findByText("Магазин Центр");

    const links = screen.getAllByRole("link");
    const detailLink = links.find((l) => l.getAttribute("href") === "/admin/reports/101");
    expect(detailLink).toBeDefined();
  });
});
