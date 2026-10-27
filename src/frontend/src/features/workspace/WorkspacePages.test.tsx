import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/shared/context/ThemeContext";
import type { SessionDTO, StoreReportDTO } from "@/shared/api/types";
import { formatCurrency } from "@/shared/i18n/uk";
import WorkspaceDashboardPage from "./WorkspaceDashboardPage";
import WorkspaceLayout from "./WorkspaceLayout";
import WorkspacePermissionPage from "./WorkspacePermissionPage";

const auth = vi.hoisted(() => ({
  session: null as SessionDTO | null,
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    isAuthenticated: Boolean(auth.session),
    login: vi.fn(),
    logout: vi.fn(),
    refetchSession: vi.fn(),
  }),
}));

const baseSession: SessionDTO = {
  login: "olena",
  name: "Олена Петренко",
  role: "store",
  store_id: 1,
  store_name: "Відділ логістики",
  department_id: 1,
  department_name: "Відділ логістики",
  permissions: ["sales_report"],
  period: "2026-10",
};

const mockReport: StoreReportDTO = {
  report_id: 10,
  store_name: "Відділ логістики",
  period: "2026-10",
  status: "draft",
  read_only: false,
  rows: [
    {
      id: 101,
      name: "Хліб пшеничний",
      repriced: false,
      sum_cents: 2500,
      inputs: [
        {
          price_cents: 2500,
          quantity: 1,
          label: "",
          sum_cents: 2500,
        },
      ],
    },
  ],
  inactive_rows: [],
  inactive_total_cents: 0,
  total_cents: 123400,
  available_periods: ["2026-10"],
};

describe("Workspace pages", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    auth.session = baseSession;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["storeReport", "2026-10"], mockReport);
  });

  function renderDashboard() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkspaceDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("shows the current report status and totals on the dashboard", () => {
    renderDashboard();

    expect(screen.getByText(/Вітаємо, Олена Петренко/)).toBeDefined();
    expect(screen.getByText("Відділ логістики")).toBeDefined();
    expect(screen.getByText("Поточний звіт")).toBeDefined();
    expect(screen.getByText("Чернетка")).toBeDefined();
    expect(screen.getByText(formatCurrency(123400))).toBeDefined();
    expect(screen.getByRole("button", { name: /Продовжити звіт/i })).toBeDefined();
    expect(screen.queryByRole("link", { name: /Замовлення транспорту/ })).toBeNull();
  });

  it("filters available sections when the report permission is absent", () => {
    auth.session = { ...baseSession, permissions: ["driver"] };
    renderDashboard();

    expect(screen.queryByText("Поточний звіт")).toBeNull();
    expect(screen.getByText("Ваші розділи")).toBeDefined();
    expect(screen.getByRole("link", { name: /Водій/ })).toBeDefined();
  });

  it("links the report navigation item directly to the report screen", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <MemoryRouter initialEntries={["/workspace"]}>
            <Routes>
              <Route path="/workspace" element={<WorkspaceLayout />}>
                <Route index element={<div>Dashboard</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    );

    const reportLinks = screen.getAllByRole("link", { name: /Мій звіт/ });
    expect(reportLinks.length).toBeGreaterThan(0);
    for (const reportLink of reportLinks) {
      expect(reportLink.getAttribute("href")).toBe("/report");
    }
  });

  it("shows an access message for a section outside the permissions", () => {
    render(
      <MemoryRouter initialEntries={["/workspace/driver"]}>
        <Routes>
          <Route path="/workspace/:permissionPath" element={<WorkspacePermissionPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Немає доступу")).toBeDefined();
    expect(screen.getByText(/не має дозволу «Водій»/)).toBeDefined();
  });

  it("opens the report directly from the dashboard", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDashboardPage />} />
            <Route path="/report" element={<div>Report screen</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Продовжити звіт/i }));

    expect(screen.getByText("Report screen")).toBeDefined();
  });
});
