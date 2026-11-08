import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/platform/theme/ThemeContext";
import { AuthProvider } from "@/platform/auth/AuthContext";
import StoreReportPage from "./StoreReportPage";
import type { SessionDTO, DayReportDTO, MonthDaysDTO, ReportLineDTO, InactiveReportLineDTO } from "@/platform/api/types";

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

const mockRows: ReportLineDTO[] = [
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
  ];

const mockInactive: InactiveReportLineDTO[] = [
    {
      name: "Старий товар",
      archived: true,
      lines: "1 × 10.00",
      sum_cents: 1000,
    },
  ];

const mockDays: MonthDaysDTO = {
  report_id: 10,
  store_name: "Тестовий магазин",
  period: "2026-10",
  status: "draft",
  total_cents: 23000,
  first_day: "2026-10-01",
  last_day: "2026-10-06",
  today: "2026-10-06",
  available_periods: ["2026-09", "2026-10"],
  days: [
    { day: "2026-10-05", status: "submitted", total_cents: 7000, item_count: 1, missed: false },
    { day: "2026-10-06", status: "draft", total_cents: 16000, item_count: 3, missed: false },
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
  rows: mockRows,
  inactive_rows: mockInactive,
  inactive_total_cents: 1000,
  total_cents: 16000,
  missed: false,
  closed: false,
  revision: 4,
  saved: { by: "Іван Коваль", signed_at: "2026-10-06T09:00:00Z" },
};

let conflict = false;

describe("StoreReportPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["session"], mockSession);
    localStorage.clear();
    conflict = false;

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/session")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession),
        });
      }
      if (url.includes("/api/v1/store/reports/2026-10/days/2026-10-06") && init?.method === "PUT" && conflict) {
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: "Conflict",
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({ detail: "Звіт за цей день щойно змінив(ла) Іван Коваль. Оновіть дані й перевірте кількості, щоб не задвоїти й не затерти чужі зміни." }),
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
          json: () => Promise.resolve(mockDays),
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
    expect(screen.getByRole("button", { name: /4 жовтня 2026.*закрито/ })).toBeDefined();
    expect(screen.getByText(/Надішліть звіт до 00:00/)).toBeDefined();
    expect(screen.getByText("днів надіслано 1 з 2")).toBeDefined();

    expect(screen.queryByRole("button", { name: /^Місяць/ })).toBeNull();
    expect(screen.queryByText("Товари за місяць")).toBeNull();
  });

  it("explains a day closed at midnight without a submission", async () => {
    const original = { ...mockDay };
    Object.assign(mockDay, { status: "submitted", read_only: true, missed: true, auto_locked_at: "2026-10-06T21:00:00Z" });
    try {
      renderPage();
      expect(await screen.findByText(/не надіслано вчасно: день закрито автоматично опівночі/)).toBeDefined();
      expect(screen.getByText("Не надіслано вчасно")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Надіслати день/ })).toBeNull();
    } finally {
      Object.assign(mockDay, original);
    }
  });

  it("sends the loaded revision, names who saved last and offers a reload on a colleague's newer save", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");
    expect(screen.getByText(/Востаннє зберіг\(ла\): Іван Коваль/)).toBeDefined();
    conflict = true;
    fireEvent.click(screen.getByRole("button", { name: /Зберегти чернетку/i }));
    expect(await screen.findByText(/щойно змінив\(ла\) Іван Коваль/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Оновити дані" })).toBeDefined();
    const put = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body as string).revision).toBe(4);
  });

  it("does not restore a local draft made before a colleague's newer save", async () => {
    localStorage.setItem(
      "easyMourningReport.draft.1.2026-10:2026-10-06",
      JSON.stringify({ period: "2026-10:2026-10-06", storeId: 1, timestamp: 1, quantities: { "101_2500": 9 }, revision: 3 }),
    );
    renderPage();
    await screen.findByText("Хліб пшеничний");
    expect(await screen.findByText(/колега зберіг\(ла\) цей день/)).toBeDefined();
    expect((screen.getByRole("textbox", { name: "Кількість: Хліб пшеничний, 25,00\u00a0₴" }) as HTMLInputElement).value).toBe("2");
  });

  it("does not offer to submit an empty day", async () => {
    const original = { ...mockDay };
    Object.assign(mockDay, {
      rows: mockRows.map((r) => ({ ...r, sum_cents: 0, inputs: (r.inputs ?? []).map((i) => ({ ...i, quantity: 0, sum_cents: 0 })) })),
    });
    try {
      renderPage();
      await screen.findByText("Хліб пшеничний");
      const submit = screen.getByRole("button", { name: /Надіслати день/ }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      expect(screen.getByText(/внесіть кількість хоча б одного товару/)).toBeDefined();
      fireEvent.click(screen.getAllByLabelText(/Збільшити кількість/i)[0]);
      await waitFor(() => expect((screen.getByRole("button", { name: /Надіслати день/ }) as HTMLButtonElement).disabled).toBe(false));
    } finally {
      Object.assign(mockDay, original);
    }
  });
});
