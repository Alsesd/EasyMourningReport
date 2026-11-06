import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProtectedRoute } from "./ProtectedRoute";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { mockFetch } from "@/test/fetchMock";

const session = { user_id: 1, login: "u", full_name: "", organisation: null, roles: [], permissions: ["reports.review"], modules: [], period: "2026-11" };

function show(answer: unknown, permissions?: string[]) {
  mockFetch({ "GET /api/v1/session": answer as never });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/secret"]}>
          <Routes>
            <Route path="/login" element={<p>login page</p>} />
            <Route path="/admin/reports" element={<p>home page</p>} />
            <Route path="/secret" element={<ProtectedRoute permissions={permissions}><p>secret</p></ProtectedRoute>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("ProtectedRoute", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a spinner while the session loads, then the page", async () => {
    show(session);
    expect(screen.getByText("Завантаження…")).toBeDefined();
    expect(await screen.findByText("secret")).toBeDefined();
  });

  it("sends signed-out visitors to the login page", async () => {
    show([401, { detail: "x" }]);
    expect(await screen.findByText("login page")).toBeDefined();
  });

  it("sends users without the permission to their landing page", async () => {
    show(session, ["transport.orders.manage"]);
    expect(await screen.findByText("home page")).toBeDefined();
  });
});
