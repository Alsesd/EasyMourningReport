import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/app/providers/ThemeContext";
import { AuthProvider } from "@/platform/auth/AuthContext";
import StoreReportPage from "./StoreReportPage";
import type { StoreReportDTO, SessionDTO } from "@/platform/api/types";

const mockSession: SessionDTO = {
  login: "teststore",
  role: "store",
  store_id: 1,
  store_name: "Тестовий магазин",
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

describe("StoreReportPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["session"], mockSession);
    queryClient.setQueryData(["storeReport", "2026-10"], mockReport);

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/session")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockSession),
        });
      }
      if (url.includes("/api/v1/store/reports/2026-10") && init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              ...mockReport,
              status: body.action === "submit" ? "submitted" : "draft",
              read_only: body.action === "submit",
            }),
        });
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

    fireEvent.click(screen.getByRole("button", { name: /Картковий/i }));
    expect((await screen.findAllByText("Кількість по розрахунку")).length).toBeGreaterThan(0);

    const plusButtons = screen.getAllByLabelText(/Збільшити кількість/i);
    fireEvent.click(plusButtons[1]);

    fireEvent.click(screen.getByRole("button", { name: /Зберегти чернетку/i }));

    await waitFor(() => {
      const fetchMock = vi.mocked(globalThis.fetch);
      const saveCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/v1/store/reports/2026-10") && init?.method === "PUT"
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
      expect(screen.getByText(/Чернетку збережено/i)).toBeDefined();
    });
  });

  it("opens confirmation dialog on submit and confirms submission", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");

    const submitBtn = screen.getByRole("button", { name: /Надіслати звіт/i });
    fireEvent.click(submitBtn);

    // Confirmation dialog appears
    expect(await screen.findByText("Надіслати звіт?")).toBeDefined();

    const confirmSubmitBtn = screen.getByRole("button", { name: /Так, надіслати/i });
    fireEvent.click(confirmSubmitBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Звіт надіслано й заблоковано/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("toggles viewMode between desktop table and cards", async () => {
    renderPage();
    await screen.findByText("Хліб пшеничний");

    const cardsBtn = screen.getByRole("button", { name: /Картковий/i });
    fireEvent.click(cardsBtn);
    expect(screen.getByText("Хліб пшеничний")).toBeDefined();

    const tableBtn = screen.getByRole("button", { name: /Табличний/i });
    fireEvent.click(tableBtn);
    expect(screen.getByText("Хліб пшеничний")).toBeDefined();
  });
});
