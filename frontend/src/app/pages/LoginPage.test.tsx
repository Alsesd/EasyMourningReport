import { StrictMode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  type Login = (o?: { conditional?: boolean; signal?: AbortSignal }) => Promise<unknown>;

  async function mount(opts: { login: Login; conditional: boolean; strict?: boolean }) {
    vi.resetModules();
    vi.doMock("@/platform/auth/passkeys", () => ({
      passkeysSupported: () => true,
      conditionalMediationAvailable: () => Promise.resolve(opts.conditional),
      passkeyApi: { login: opts.login },
    }));
    const { LoginPage: Page } = await import("./LoginPage");
    const { AuthProvider: Provider } = await import("@/platform/auth/AuthContext");
    const { ThemeProvider: Theme } = await import("@/platform/theme/ThemeContext");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["session"], null);
    const tree = (
      <QueryClientProvider client={qc}>
        <Theme>
          <Provider>
            <BrowserRouter>
              <Page />
            </BrowserRouter>
          </Provider>
        </Theme>
      </QueryClientProvider>
    );
    return render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  }

  // A prompt that stays open until the page aborts it, like a real conditional request.
  const pending: Login = (o) => new Promise((_, reject) => o?.signal?.addEventListener("abort", () => reject(new DOMException("a", "AbortError"))));

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.doUnmock("@/platform/auth/passkeys");
  });

  it("starts the device prompt by itself only on a device that agreed, and stays quiet when it is dismissed", async () => {
    window.localStorage.setItem("legkyi.biometric", "on");
    const login = vi.fn<Login>().mockRejectedValue(new DOMException("c", "NotAllowedError"));
    await mount({ login, conditional: false });
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0][0]?.conditional).toBeUndefined();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not prompt a device that never agreed when conditional sign-in is unavailable", async () => {
    const login = vi.fn<Login>().mockRejectedValue(new DOMException("c", "NotAllowedError"));
    await mount({ login, conditional: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(login).not.toHaveBeenCalled();
  });

  it("offers the passkey in the login field's autofill list when the browser supports it", async () => {
    const login = vi.fn<Login>(pending);
    await mount({ login, conditional: true });
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0][0]?.conditional).toBe(true);
    expect(screen.getByLabelText(/Логін/i).getAttribute("autocomplete")).toBe("username webauthn");
  });

  it("falls back to the autofill list when the automatic prompt is dismissed", async () => {
    window.localStorage.setItem("legkyi.biometric", "on");
    const login = vi.fn<Login>().mockRejectedValueOnce(new DOMException("c", "NotAllowedError")).mockImplementation(pending);
    await mount({ login, conditional: true });
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    expect(login.mock.calls[0][0]?.conditional).toBeUndefined();
    expect(login.mock.calls[1][0]?.conditional).toBe(true);
  });

  it("holds the automatic prompt back once after a sign-out but still offers the autofill list", async () => {
    window.localStorage.setItem("legkyi.biometric", "on");
    window.sessionStorage.setItem("legkyi.noAutoBiometric", "1");
    const login = vi.fn<Login>(pending);
    await mount({ login, conditional: true });
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0][0]?.conditional).toBe(true);
    expect(window.sessionStorage.getItem("legkyi.noAutoBiometric")).toBeNull();
  });

  it("survives the double effect of StrictMode: exactly one prompt stays live", async () => {
    window.localStorage.setItem("legkyi.biometric", "on");
    const live: AbortSignal[] = [];
    const login = vi.fn<Login>((o) => {
      if (o?.signal) live.push(o.signal);
      return pending(o);
    });
    await mount({ login, conditional: false, strict: true });
    await waitFor(() => expect(live.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    expect(live.filter((s) => !s.aborted)).toHaveLength(1);
  });
});
