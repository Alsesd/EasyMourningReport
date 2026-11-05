import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingsPage from "./SettingsPage";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { ModuleRegistryContext } from "@/platform/modules";
import { appModules } from "@/app/registry";
import type { ProductDTO, ReportSettingsDTO, SessionDTO } from "@/platform/api/types";

const adminSession: SessionDTO = {
  user_id: 1,
  login: "admin",
  full_name: "",
  organisation: null,
  roles: ["Адміністратор"],
  permissions: [
    "platform.system.manage",
    "reports.catalog.manage",
    "reports.settings.manage",
    "platform.users.manage",
  ],
  modules: ["platform", "reports", "transport"],
  period: "2026-10",
};

const storeSession: SessionDTO = {
  ...adminSession,
  user_id: 2,
  login: "store1",
  organisation: { id: 1, name: "Магазин Центр" },
  roles: ["Магазин"],
  permissions: ["reports.submit"],
};

const mockProducts: ProductDTO[] = [
  { id: 1, name: "Свічка поминальна", price_cents: 2500, active: true, archived: false, used_count: 5, month_prices_cents: [2500] },
  { id: 2, name: "Хустка чорна", price_cents: 4000, active: false, archived: false, used_count: 0, month_prices_cents: [4000] },
  { id: 3, name: "Старий товар в архіві", price_cents: 1000, active: false, archived: true, used_count: 1, month_prices_cents: [1000] },
];

const mockReportSettings: ReportSettingsDTO[] = [
  { organisation_id: 1, organisation_name: "Магазин Центр", archived: false, calculation_enabled: true, reports_count: 3 },
];

const mockTunnel = {
  enabled: true,
  autostart: true,
  state: "running",
  public_url: "https://test-tunnel.trycloudflare.com",
  login_url: "",
  error: "",
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}

describe("SettingsPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/admin/products")) return json(mockProducts);
      if (url.includes("/api/v1/reports/settings/1") && init?.method === "PUT") {
        return json({ ...mockReportSettings[0], calculation_enabled: false });
      }
      if (url.includes("/api/v1/reports/settings")) return json(mockReportSettings);
      if (url.includes("/api/v1/admin/tunnel")) return json(mockTunnel);
      return Promise.reject(new Error("Unknown route: " + url));
    });
  });

  function renderPage(session: SessionDTO, initialEntries = ["/admin/settings"]) {
    queryClient.setQueryData(["session"], session);
    return render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ModuleRegistryContext.Provider value={appModules}>
            <MemoryRouter initialEntries={initialEntries}>
              <SettingsPage />
            </MemoryRouter>
          </ModuleRegistryContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  it("shows every section an administrator may open, products first", async () => {
    renderPage(adminSession);
    for (const name of [/^Товари$/, /^Звіти організацій$/, /^Публічний доступ$/, /^Резервні копії$/, /^Мій пароль$/]) {
      expect(screen.getByRole("tab", { name })).toBeDefined();
    }
    expect(await screen.findByDisplayValue("Свічка поминальна")).toBeDefined();
    expect(screen.getByText("Неактивні товари (1)")).toBeDefined();
    expect(screen.getByText("Архів товарів (1)")).toBeDefined();
  });

  it("offers a store user only their own password", async () => {
    renderPage(storeSession);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Мій пароль"]);
    expect(await screen.findByLabelText("Новий пароль")).toBeDefined();
  });

  it("filters products by search input", async () => {
    renderPage(adminSession);
    await screen.findByDisplayValue("Свічка поминальна");
    fireEvent.change(screen.getByPlaceholderText(/Пошук товарів за назвою/i), { target: { value: "свічка" } });
    expect(screen.getByDisplayValue("Свічка поминальна")).toBeDefined();
  });

  it("toggles the calculation mode per organisation", async () => {
    renderPage(adminSession, ["/admin/settings?tab=report-settings"]);
    const toggle = await screen.findByRole("checkbox", { name: /Магазин Центр/ });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    expect(await screen.findByText("Налаштування звітів збережено.")).toBeDefined();
    const fetchMock = vi.mocked(globalThis.fetch);
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ calculation_enabled: false });
  });

  it("renders the live tunnel url", async () => {
    renderPage(adminSession, ["/admin/settings?tab=tunnel"]);
    expect(await screen.findByText("https://test-tunnel.trycloudflare.com")).toBeDefined();
    expect(screen.getByText(/Автозапуск при старті системи/i)).toBeDefined();
  });

  it("links the backup download to the API", async () => {
    renderPage(adminSession, ["/admin/settings?tab=backup"]);
    const link = await screen.findByRole("link", { name: /Завантажити резервну копію/i });
    expect(link.getAttribute("href")).toBe("/api/v1/admin/backup/download");
  });
});
