import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminHubPage from "./AdminHubPage";
import LegacyRedirect from "./LegacyRedirect";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { ModuleRegistryContext } from "@/platform/modules";
import { appModules } from "@/app/registry";
import type { AdminOverviewDTO, ProductDTO, ReportSettingsDTO, SessionDTO } from "@/platform/api/types";

const admin: SessionDTO = {
  user_id: 1,
  login: "admin",
  full_name: "",
  organisation: null,
  roles: ["Адміністратор"],
  permissions: [
    "platform.audit.view",
    "platform.organisations.manage",
    "platform.roles.manage",
    "platform.system.manage",
    "platform.users.manage",
    "reports.catalog.manage",
    "reports.settings.manage",
  ],
  modules: ["platform", "reports", "transport"],
  period: "2026-10",
};

const orgAdmin: SessionDTO = {
  ...admin,
  user_id: 2,
  login: "manager",
  organisation: { id: 1, name: "Магазин Центр" },
  roles: ["Адміністратор організації"],
  permissions: ["org.users.manage", "reports.submit"],
};

const overview: AdminOverviewDTO = {
  accounts: { organisations: 4, archived_organisations: 1, users: 9, inactive_users: 2, roles: 3 },
  tunnel: { enabled: true, autostart: true, has_token: true, state: "running", public_url: "https://zvit.example.com", error: "" },
  health: {
    database_ok: true, integrity: "ok", journal_mode: "wal", database_size_bytes: 2048,
    backups_count: 12, last_backup_at: "2026-10-30T10:00:00Z", backup_every_min: 60,
  },
  recent_activity: [{ id: 7, ts: "2026-10-30T10:00:00Z", login: "admin", role: "Адміністратор", action: "вхід", detail: "", ip: "1.2.3.4" }],
  modules: [{ module: "reports", title: "Звіти", stats: [{ label: "Активних товарів", value: "42", hint: "в архіві: 3", section: "products" }] }],
};

const products: ProductDTO[] = [
  { id: 1, name: "Свічка поминальна", price_cents: 2500, active: true, archived: false, used_count: 5, month_prices_cents: [2500] },
  { id: 3, name: "Старий товар в архіві", price_cents: 1000, active: false, archived: true, used_count: 1, month_prices_cents: [1000] },
];
const reportSettings: ReportSettingsDTO[] = [
  { organisation_id: 1, organisation_name: "Магазин Центр", archived: false, calculation_enabled: true, reports_count: 3 },
];

function json(data: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
}

describe("AdminHubPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/admin/overview")) return json(overview);
      if (url.includes("/api/v1/admin/products")) return json(products);
      if (url.includes("/api/v1/reports/settings/1") && init?.method === "PUT") return json({ ...reportSettings[0], calculation_enabled: false });
      if (url.includes("/api/v1/reports/settings")) return json(reportSettings);
      if (url.includes("/api/v1/admin/tunnel")) return json(overview.tunnel);
      if (url.includes("/api/v1/admin/system/health")) return json(overview.health);
      if (url.includes("/api/v1/admin/backups")) return json([{ name: "reports-20261030-100000.db", size_bytes: 2048, created_at: "2026-10-30T10:00:00Z" }]);
      if (url.includes("/api/v1/users")) return json([]);
      if (url.includes("/api/v1/roles")) return json([]);
      if (url.includes("/api/v1/organisations")) return json([]);
      return Promise.reject(new Error("Unknown route: " + url));
    });
  });

  function renderAt(session: SessionDTO, path: string) {
    queryClient.setQueryData(["session"], session);
    return render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ModuleRegistryContext.Provider value={appModules}>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/admin/manage" element={<AdminHubPage />} />
                <Route path="/admin/manage/:sectionId" element={<AdminHubPage />} />
                <Route path="/admin/settings" element={<LegacyRedirect />} />
                <Route path="/admin/logs" element={<LegacyRedirect />} />
              </Routes>
            </MemoryRouter>
          </ModuleRegistryContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  it("names the current section on the phone picker", () => {
    renderAt(admin, "/admin/manage/users");
    expect(screen.getByRole("button", { name: "Розділи адміністрування: Користувачі" })).toBeDefined();
  });

  it("shows the overview with figures that link to their sections", async () => {
    renderAt(admin, "/admin/manage");
    expect(await screen.findByText("Облікові записи")).toBeDefined();
    expect(screen.getByText("https://zvit.example.com")).toBeDefined();
    expect(screen.getByText("збережено копій: 12")).toBeDefined();
    expect(screen.getByText("42").closest("a")?.getAttribute("href")).toBe("/admin/manage/products");
    expect(screen.getByRole("link", { name: /Увесь журнал/ }).getAttribute("href")).toBe("/admin/manage/audit");
  });

  it("sends a forbidden section back to the overview", async () => {
    renderAt(orgAdmin, "/admin/manage/backups");
    expect(await screen.findByRole("heading", { level: 1, name: "Адміністрування" })).toBeDefined();
  });

  it("renders a module's catalogue section", async () => {
    renderAt(admin, "/admin/manage/products");
    expect(screen.getByRole("heading", { level: 1, name: "Товари й ціни" })).toBeDefined();
    expect(await screen.findByDisplayValue("Свічка поминальна")).toBeDefined();
    expect(screen.getByText("Архів товарів (1)")).toBeDefined();
  });

  it("toggles the calculation mode and confirms with a notice", async () => {
    renderAt(admin, "/admin/manage/report-settings");
    const toggle = await screen.findByRole("switch", { name: /Магазин Центр/ });
    fireEvent.click(toggle);
    expect(await screen.findByText("Налаштування звітів збережено.")).toBeDefined();
    const put = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ calculation_enabled: false });
  });

  it("shows database health and recent backups", async () => {
    renderAt(admin, "/admin/manage/backups");
    expect(await screen.findByText("Цілісність перевірено")).toBeDefined();
    expect(await screen.findByText("reports-20261030-100000.db")).toBeDefined();
    expect(screen.getByRole("link", { name: /Створити копію й завантажити/ }).getAttribute("href")).toBe("/api/v1/admin/backup/download");
    expect(screen.getByRole("link", { name: /Завантажити копію reports-20261030-100000\.db/ }).getAttribute("href")).toBe(
      "/api/v1/admin/backups/reports-20261030-100000.db/download",
    );
  });

  it("redirects old settings bookmarks to the matching section", async () => {
    renderAt(admin, "/admin/settings?tab=tunnel");
    expect(await screen.findByRole("heading", { level: 1, name: "Публічний доступ" })).toBeDefined();
    expect(await screen.findByText("https://zvit.example.com")).toBeDefined();
  });
});
