import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminReportDetailPage from "./AdminReportDetailPage";
import type { AdminReportDetailDTO, DayReportDTO, MonthDaysDTO } from "@/platform/api/types";

const mockDetail: AdminReportDetailDTO = {
  report_id: 101,
  store_id: 1,
  store_name: "Магазин Центр",
  store_archived: false,
  calculation_enabled: false,
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
          quantity_calc: 0,
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
          quantity_calc: 0,
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

const mockDays: MonthDaysDTO = {
  report_id: 101,
  store_name: "Магазин Центр",
  period: "2026-10",
  status: "draft",
  daily: true,
  total_cents: 9000,
  first_day: "2026-10-01",
  last_day: "2026-10-31",
  today: "2026-11-06",
  undated: null,
  days: [
    { day: "2026-10-05", status: "draft", total_cents: 4000, item_count: 1 },
    { day: "2026-10-07", status: "submitted", total_cents: 5000, item_count: 1 },
  ],
};

const mockDay: DayReportDTO = {
  report_id: 101,
  store_id: 3,
  store_name: "Магазин Центр",
  store_archived: false,
  period: "2026-10",
  day: "2026-10-05",
  status: "draft",
  month_status: "draft",
  read_only: false,
  calculation_enabled: false,
  rows: [
    { id: 7, name: "Вінок денний", repriced: false, sum_cents: 4000, inputs: [{ price_cents: 2000, quantity: 2, quantity_calc: 0, label: "", sum_cents: 4000 }] },
  ],
  inactive_rows: [],
  inactive_total_cents: 0,
  total_cents: 4000,
};

let daily = false;

describe("AdminReportDetailPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    daily = false;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["adminReportDetail", "101"], mockDetail);

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/admin/reports/101/days/2026-10-05") && init?.method === "PATCH") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...mockDay, status: "submitted" }) });
      }
      if (url.includes("/api/v1/admin/reports/101/days/2026-10-05")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockDay) });
      }
      if (url.includes("/api/v1/admin/reports/101/days")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(daily ? mockDays : { ...mockDays, daily: false, days: [] }) });
      }
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

  function renderPage(entry = "/admin/reports/101") {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
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
    expect(screen.queryByText("Розблокувати звіт")).toBeNull();
  });

  it("shows the month as a read-only view without a lock", async () => {
    daily = true;
    renderPage();
    await screen.findByText("Магазин Центр");
    expect(await screen.findByText(/Звіт за місяць лише для перегляду/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Заблокувати|Розблокувати/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Місяць/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens one day from the link of a notification and locks that day", async () => {
    daily = true;
    renderPage("/admin/reports/101?day=2026-10-05");
    expect(await screen.findByText("Вінок денний")).toBeDefined();
    expect(screen.getByRole("group", { name: "Дні місяця" })).toBeDefined();
    expect(screen.getByRole("button", { name: /5 жовтня 2026.*Чернетка/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("днів надіслано 1 з 2")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Заблокувати день" }));
    expect(await screen.findByText("Заблокувати звіт за день?")).toBeDefined();
    const confirm = screen.getAllByRole("button", { name: "Заблокувати день" });
    fireEvent.click(confirm[confirm.length - 1]);
    await waitFor(() => expect(screen.getByText("День заблоковано.")).toBeDefined());
    const patch = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => String(url).includes("/days/2026-10-05") && init?.method === "PATCH");
    expect(JSON.parse(patch?.[1]?.body as string)).toEqual({ status: "submitted" });
  });
});
