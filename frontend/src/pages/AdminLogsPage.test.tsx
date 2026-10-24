import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminLogsPage from "./AdminLogsPage";
import type { AuditLogDTO } from "@/api/types";

const mockActions = ["auth.login", "report.submit", "product.update"];

const mockLogs: AuditLogDTO[] = [
  {
    id: 1,
    ts: "2026-10-24T18:00:00Z",
    login: "admin",
    role: "admin",
    action: "auth.login",
    detail: "Успішний вхід",
    ip: "127.0.0.1",
  },
  {
    id: 2,
    ts: "2026-10-24T18:05:00Z",
    login: "store1",
    role: "store",
    action: "report.submit",
    detail: "Звіт за 2026-10 подано",
    ip: "192.168.1.10",
  },
];

describe("AdminLogsPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["adminLogActions"], mockActions);
    queryClient.setQueryData(["adminLogs", "", ""], mockLogs);

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/admin/log-actions")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockActions),
        });
      }
      if (url.includes("/api/v1/admin/logs")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockLogs),
        });
      }
      return Promise.reject(new Error("Unknown route"));
    });
  });

  function renderPage(initialEntries = ["/admin/logs"]) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <AdminLogsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("renders log title, action options, and log table rows", async () => {
    renderPage();
    expect(await screen.findByText("Журнал аудиту")).toBeDefined();
    expect(screen.getByText("Усі дії")).toBeDefined();
    expect(screen.getAllByText("auth.login").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("report.submit").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Успішний вхід")).toBeDefined();
    expect(screen.getByText("Звіт за 2026-10 подано")).toBeDefined();
  });

  it("allows entering login and submitting filter", async () => {
    renderPage();
    await screen.findByText("Журнал аудиту");

    const input = screen.getByLabelText("Логін");
    fireEvent.change(input, { target: { value: "store1" } });
    expect((input as HTMLInputElement).value).toBe("store1");

    const submitBtn = screen.getByRole("button", { name: /Фільтрувати/i });
    fireEvent.click(submitBtn);
  });
});
