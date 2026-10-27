import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/app/providers/ThemeContext";
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
});
