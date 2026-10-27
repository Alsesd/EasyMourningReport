import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminSettingsPage from "./AdminSettingsPage";
import type { ProductDTO, StoreDTO, UserDTO } from "@/shared/api/types";

const mockProducts: ProductDTO[] = [
  {
    id: 1,
    name: "Свічка поминальна",
    price_cents: 2500,
    active: true,
    archived: false,
    used_count: 5,
    month_prices_cents: [2500],
  },
  {
    id: 2,
    name: "Хустка чорна",
    price_cents: 4000,
    active: false,
    archived: false,
    used_count: 0,
    month_prices_cents: [4000],
  },
  {
    id: 3,
    name: "Старий товар в архіві",
    price_cents: 1000,
    active: false,
    archived: true,
    used_count: 1,
    month_prices_cents: [1000],
  },
];

const mockStores: StoreDTO[] = [
  {
    id: 1,
    name: "Магазин Центр",
    login: "store_center",
    archived: false,
    reports_count: 3,
    users: [
      {
        id: 2,
        name: "Олена Петренко",
        login: "store_center",
        permissions: ["sales_report"],
      },
    ],
  },
  {
    id: 2,
    name: "Магазин Захід (Архів)",
    login: "store_west",
    archived: true,
    reports_count: 0,
    users: [],
  },
];

const mockUsers: UserDTO[] = [
  {
    id: 1,
    name: "Адміністратор",
    login: "admin",
    role: "admin",
    permissions: ["transport_order", "sales_report", "vehicle_dispatch", "driver"],
  },
  {
    id: 2,
    name: "Олена Петренко",
    login: "store_center",
    role: "store",
    department_id: 1,
    department_name: "Магазин Центр",
    permissions: ["sales_report"],
  },
];

const mockTunnel = {
  enabled: true,
  autostart: true,
  state: "running",
  public_url: "https://test-tunnel.trycloudflare.com",
  login_url: "",
  error: "",
};

describe("AdminSettingsPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["adminProducts"], mockProducts);
    queryClient.setQueryData(["adminStores"], mockStores);
    queryClient.setQueryData(["adminUsers"], mockUsers);
    queryClient.setQueryData(["adminTunnel"], mockTunnel);

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/admin/products")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockProducts),
        });
      }
      if (url.includes("/api/v1/admin/stores")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockStores),
        });
      }
      if (url.includes("/api/v1/admin/users")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockUsers),
        });
      }
      if (url.includes("/api/v1/admin/tunnel")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockTunnel),
        });
      }
      return Promise.reject(new Error("Unknown route: " + url));
    });
  });

  function renderPage(initialEntries = ["/admin/settings?tab=products"]) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <AdminSettingsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("renders tabs and products list", async () => {
    renderPage();
    expect(await screen.findByText("Налаштування та довідники")).toBeDefined();
    expect(screen.getByRole("button", { name: /^Товари$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Користувачі$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Відділи$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Безпека$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Публічний доступ$/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Резервні копії$/i })).toBeDefined();

    expect(screen.getByDisplayValue("Свічка поминальна")).toBeDefined();
    expect(screen.getByText("Неактивні товари (1)")).toBeDefined();
    expect(screen.getByText("Архів товарів (1)")).toBeDefined();
  });

  it("filters products by search input", async () => {
    renderPage();
    await screen.findByText("Налаштування та довідники");

    const searchInput = screen.getByPlaceholderText(/Пошук товарів за назвою/i);
    fireEvent.change(searchInput, { target: { value: "свічка" } });

    expect(screen.getByDisplayValue("Свічка поминальна")).toBeDefined();
  });

  it("switches to users tab and renders users with permissions", async () => {
    renderPage(["/admin/settings?tab=users"]);
    expect(await screen.findByText(/Користувачі \(2\)/i)).toBeDefined();
    expect(screen.getByText("Олена Петренко")).toBeDefined();
    expect(screen.getAllByText("Адміністратор").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Звіт по продажу").length).toBeGreaterThan(0);
  });

  it("switches to departments tab and renders department statistics", async () => {
    renderPage(["/admin/settings?tab=departments"]);
    expect(await screen.findByText(/Відділи \(1\)/i)).toBeDefined();
    expect(screen.getByDisplayValue("Магазин Центр")).toBeDefined();
    expect(screen.getByText("Архів відділів (1)")).toBeDefined();
    expect(screen.getByText(/Користувачі відділу/i)).toBeDefined();
  });

  it("switches to tunnel tab and renders live public url", async () => {
    renderPage(["/admin/settings?tab=tunnel"]);
    expect(await screen.findByText("https://test-tunnel.trycloudflare.com")).toBeDefined();
    expect(screen.getByText(/Автозапуск при старті системи/i)).toBeDefined();
  });

  it("switches to backup tab and has direct server download link", async () => {
    renderPage(["/admin/settings?tab=backup"]);
    const link = await screen.findByRole("link", { name: /Завантажити резервну копію/i });
    expect(link.getAttribute("href")).toBe("/admin/backup/download");
  });
});
