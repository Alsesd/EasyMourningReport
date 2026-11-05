import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { AccountMenu } from "./AccountMenu";
import type { SessionDTO } from "@/platform/api/types";

const session: SessionDTO = {
  user_id: 3,
  login: "store1",
  full_name: "",
  organisation: { id: 1, name: "Магазин 1" },
  roles: ["Магазин"],
  permissions: ["reports.submit"],
  modules: [],
  period: "2026-10",
};

describe("AccountMenu", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(url.includes("/me/password") ? { message: "Ваш пароль змінено." } : session),
      }),
    );
  });

  function renderMenu() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["session"], session);
    return render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccountMenu />
        </AuthProvider>
      </QueryClientProvider>,
    );
  }

  it("changes the password in a dialog that Escape closes", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Обліковий запис: store1" }));
    expect(screen.getByText("store1, Магазин 1")).toBeDefined();
    await user.click(screen.getByRole("menuitem", { name: "Змінити пароль" }));

    const dialog = await screen.findByRole("dialog", { name: "Зміна власного пароля" });
    await user.type(screen.getByLabelText("Новий пароль"), "new-secret");
    await user.click(screen.getByRole("button", { name: "Змінити пароль" }));
    expect(await screen.findByText("Ваш пароль змінено.")).toBeDefined();
    const put = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ password: "new-secret" });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });

  it("signs out from the menu", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Обліковий запис: store1" }));
    await user.click(screen.getByRole("menuitem", { name: "Вийти" }));
    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("/auth/logout"))).toBe(true),
    );
  });
});
