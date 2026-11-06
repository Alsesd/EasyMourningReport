import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/platform/theme/ThemeContext";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { LoginPage } from "./LoginPage";

describe("LoginPage", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Session is not authenticated
    queryClient.setQueryData(["session"], null);
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Not authenticated" }),
      })
    );
  });

  function renderLoginPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <BrowserRouter>
              <LoginPage />
            </BrowserRouter>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  it("renders login form with inputs and submit button", async () => {
    renderLoginPage();
    expect(await screen.findByText("Вхід до системи")).toBeDefined();
    expect(screen.getByLabelText(/Логін/i)).toBeDefined();
    expect(screen.getByLabelText("Пароль")).toBeDefined();
    expect(screen.getByRole("button", { name: /Увійти/i })).toBeDefined();
  });

  it("allows the user to reveal and re-mask the password", async () => {
    renderLoginPage();
    const passwordField = await screen.findByLabelText("Пароль") as HTMLInputElement;
    expect(passwordField.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Показати пароль" }));
    expect(passwordField.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Приховати пароль" }));
    expect(passwordField.type).toBe("password");
  });

  it("returns to the page the user was sent away from after signing in", async () => {
    const session = {
      user_id: 1, login: "admin", full_name: "", organisation: null, roles: [],
      permissions: ["platform.users.manage"], modules: [], period: "2026-10",
    };
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(String(url).includes("/auth/login") ? session : null) }),
    );
    function Where() {
      const { pathname } = useLocation();
      return <p>at {pathname}</p>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={[{ pathname: "/login", state: { from: { pathname: "/admin/manage/users", search: "" } } }]}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="*" element={<Where />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
    fireEvent.change(await screen.findByLabelText(/Логін/i), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: /Увійти/i }));
    await waitFor(() => expect(screen.getByText("at /admin/manage/users")).toBeDefined());
  });
});

describe("LoginPage biometric auto sign-in", () => {
  it("starts the device prompt by itself only on a device that agreed", async () => {
    vi.resetModules();
    const login = vi.fn().mockRejectedValue(new DOMException("c", "NotAllowedError"));
    vi.doMock("@/platform/auth/passkeys", () => ({ passkeysSupported: () => true, passkeyApi: { login } }));
    window.localStorage.setItem("legkyi.biometric", "on");
    window.sessionStorage.clear();
    const { LoginPage: Page } = await import("./LoginPage");
    const { AuthProvider: Provider } = await import("@/platform/auth/AuthContext");
    const { ThemeProvider: Theme } = await import("@/platform/theme/ThemeContext");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["session"], null);
    render(
      <QueryClientProvider client={qc}>
        <Theme>
          <Provider>
            <BrowserRouter>
              <Page />
            </BrowserRouter>
          </Provider>
        </Theme>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toBeDefined();
    window.localStorage.clear();
    vi.doUnmock("@/platform/auth/passkeys");
  });
});
