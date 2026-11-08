import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/platform/theme/ThemeContext";
import { AuthProvider } from "@/platform/auth/AuthContext";
import StoreReportPage from "./StoreReportPage";
import type { StoreReportDTO, SessionDTO, DayReportDTO, MonthDaysDTO } from "@/platform/api/types";

const mockSession: SessionDTO = {
  user_id: 5,
  login: "teststore",
  full_name: "",
  organisation: { id: 1, name: "Тестовий магазин" },
  roles: ["Магазин"],
  permissions: ["reports.submit"],
  modules: ["platform", "reports"],
  period: "2026-10",
};

const mockReport: StoreReportDTO = {
  report_id: 10,
  store_name: "Тестовий магазин",
  period: "2026-10",
  status: "draft",
  read_only: false,
  calculation_enabled: true,
  rows: [
    {
      id: 101,
      name: "Хліб пшеничний",
      repriced: false,
      sum_cents: 2500,
      inputs: [
        {
          price_cents: 2500,
          quantity: 2,
          quantity_calc: 0,
          label: "",
          sum_cents: 5000,
        },
      ],
    },
    {
      id: 102,
      name: "Молоко 2.5%",
      repriced: true,
      sum_cents: 7000,
      inputs: [
        {
          price_cents: 3000,
          quantity: 1,
          quantity_calc: 0,
          label: "old",
          sum_cents: 3000,
        },
        {
          price_cents: 3500,
          quantity: 2,
          quantity_calc: 0,
          label: "new",
          sum_cents: 7000,
        },
      ],
    },
  ],
  inactive_rows: [
    {
      name: "Старий товар",
      archived: true,
      lines: "1 × 10.00",
      sum_cents: 1000,
    },
  ],
  inactive_total_cents: 1000,
  total_cents: 16000,
  available_periods: ["2026-09", "2026-10"],
};

const mockDays: MonthDaysDTO = {
  report_id: 10,
  store_name: "Тестовий магазин",
  period: "2026-10",
  status: "draft",
  daily: true,
  total_cents: 23000,
  first_day: "2026-10-01",
  last_day: "2026-10-06",
  today: "2026-10-06",
  undated: null,
  days: [
    { day: "2026-10-05", status: "submitted", total_cents: 7000, item_count: 1 },
    { day: "2026-10-06", status: "draft", total_cents: 16000, item_count: 3 },
  ],
};

const mockDay: DayReportDTO = {
  report_id: 10,
  store_id: 1,
  store_name: "Тестовий магазин",
  store_archived: false,
  period: "2026-10",
  day: "2026-10-06",
  status: "draft",
  month_status: "draft",
  read_only: false,
  calculation_enabled: true,
  rows: mockReport.rows ?? [],
  inactive_rows: mockReport.inactive_rows ?? [],
  inactive_total_cents: 1000,
  total_cents: 16000,
};

describe("StoreReportPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["session"], mockSession);
    localStorage.clear();

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/session")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession),
        });
      }
      if (url.includes("/api/v1/store/reports/2026-10/days/2026-10-06") && init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              ...mockDay,
              status: body.action === "submit" ? "submitted" : "draft",
              read_only: body.action === "submit",
            }),
        });
      }
      if (url.includes("/api/v1/store/reports/2026-10/days/")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockDay) });
      }
      if (url.includes("/api/v1/store/reports/2026-10/days")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockDays) });
      }
      if (url.includes("/api/v1/store/reports")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockReport),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
  });

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <BrowserRouter>
              <StoreReportPage />
            </BrowserRouter>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  it("renders store name, period and products", async () => {
    renderPage();
    expect(await screen.findByText("Хліб пшеничний")).toBeDefined();
    expect(screen.getByText("Молоко 2.5%")).toBeDefined();
    expect(screen.getByText("Чернетка")).toBeDefined();
    expect(screen.getByText("Неактивні позиції (1)")).toBeDefined();
  });

  it("updates line sum when stepper is clicked", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");

    // Click "+" on the first stepper
    const plusButtons = screen.getAllByLabelText(/Збільшити кількість/i);
    fireEvent.click(plusButtons[0]);

    // Unsaved changes banner appears
    expect(await screen.findByText("Є незбережені зміни")).toBeDefined();
  });

  it("saves calculation quantities separately from reported quantities", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");

    expect(screen.getAllByText("по розрахунку").length).toBeGreaterThan(0);

    const plusButtons = screen.getAllByLabelText(/Збільшити кількість/i);
    fireEvent.click(plusButtons[1]);

    fireEvent.click(screen.getByRole("button", { name: /Зберегти чернетку/i }));

    await waitFor(() => {
      const fetchMock = vi.mocked(globalThis.fetch);
      const saveCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/v1/store/reports/2026-10/days/2026-10-06") && init?.method === "PUT"
      );
      expect(saveCall).toBeDefined();
      const payload = JSON.parse(saveCall?.[1]?.body as string);
      expect(payload.quantities[0]).toMatchObject({
        product_id: 101,
        price_cents: 2500,
        quantity: 2,
        quantity_calc: 1,
      });
    });
  });

  it("saves draft successfully", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");

    const saveDraftBtn = screen.getByRole("button", { name: /Зберегти чернетку/i });
    fireEvent.click(saveDraftBtn);

    await waitFor(() => {
      expect(screen.getByText(/Чернетку дня збережено/i)).toBeDefined();
    });
  });

  it("opens confirmation dialog on submit and confirms submission", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");

    const submitBtn = screen.getByRole("button", { name: /Надіслати день/i });
    fireEvent.click(submitBtn);

    // Confirmation dialog appears
    expect(await screen.findByText("Надіслати звіт за день?")).toBeDefined();

    const confirmSubmitBtn = screen.getByRole("button", { name: /Так, надіслати/i });
    fireEvent.click(confirmSubmitBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Звіт за день надіслано й заблоковано/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("names each quantity field after its product and price", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");
    expect(screen.getByRole("textbox", { name: "Кількість: Хліб пшеничний, 25,00\u00a0₴" })).toBeDefined();
    expect(screen.getByText("заповнено 2 з 2")).toBeDefined();
  });

  it("opens today and marks the days; the month view is not offered to the store", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");
    const strip = screen.getByRole("group", { name: "Дні місяця" });
    expect(strip).toBeDefined();
    const today = screen.getByRole("button", { name: /6 жовтня 2026.*сьогодні: Чернетка/ });
    expect(today.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /5 жовтня 2026.*Надіслано/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /4 жовтня 2026.*не заповнено/ })).toBeDefined();
    expect(screen.getByText("днів надіслано 1 з 2")).toBeDefined();

    expect(screen.queryByRole("button", { name: /^Місяць/ })).toBeNull();
    expect(screen.queryByText("Товари за місяць")).toBeNull();
  });

  it("warns on a day that the month already has quantities entered without a date", async () => {
    mockDays.undated = { day: "undated", status: "draft", total_cents: 50000, item_count: 2 };
    try {
      renderPage();
      await screen.findByText("Хліб пшеничний");
      expect(await screen.findByText(/без дати\. У день вносьте лише продажі цього дня/)).toBeDefined();
      expect(screen.getByRole("button", { name: /Без дати/ })).toBeDefined();
    } finally {
      mockDays.undated = null;
    }
  });
});
