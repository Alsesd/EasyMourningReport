import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminLayout from "./AdminLayout";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { ThemeProvider } from "@/platform/theme/ThemeContext";
import type { SessionDTO } from "@/platform/api/types";

const session: SessionDTO = {
  user_id: 1,
  login: "admin",
  full_name: "Олена Коваль",
  organisation: null,
  roles: ["Адміністратор"],
  permissions: ["reports.review", "platform.users.manage"],
  modules: ["platform", "reports"],
  period: "2026-10",
};

describe("AdminLayout", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(session) });
  });

  function renderLayout() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["session"], session);
    return render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/admin/reports"]}>
              <Routes>
                <Route path="/admin" element={<AdminLayout />}>
                  <Route path="reports" element={<p>content</p>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  it("builds navigation from the registry and the user's permissions", () => {
    renderLayout();
    const sidebar = screen.getAllByRole("navigation", { name: "Внутрішній портал" })[0];
    expect([...sidebar.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Звіти", "Адміністрування"]);
  });

  it("keeps the maker mark Easter egg", () => {
    renderLayout();
    // The rail (desktop) and the top bar (mobile) each carry the mark; CSS shows one of them.
    const trigger = screen.getAllByRole("button", { name: "Reveal creator credit" })[0];
    fireEvent.click(trigger);
    expect(screen.getAllByText("Alsesd").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Hide creator credit" })).toBeDefined();
  });

  it("shows who is signed in through the account menu", () => {
    renderLayout();
    expect(screen.getAllByRole("button", { name: /Обліковий запис: Олена Коваль/ }).length).toBeGreaterThan(0);
  });
});
