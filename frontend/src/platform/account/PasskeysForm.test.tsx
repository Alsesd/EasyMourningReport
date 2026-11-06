import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PasskeysForm } from "./PasskeysForm";
import { passkeyApi } from "@/platform/auth/passkeys";
import * as passkeys from "@/platform/auth/passkeys";

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PasskeysForm />
    </QueryClientProvider>,
  );
}

describe("PasskeysForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("explains when the browser cannot do passkeys", () => {
    vi.spyOn(passkeys, "passkeysSupported").mockReturnValue(false);
    show();
    expect(screen.getByText(/не підтримує ключі доступу/)).toBeDefined();
  });

  it("lists, adds and removes keys", async () => {
    vi.spyOn(passkeys, "passkeysSupported").mockReturnValue(true);
    const list = vi.spyOn(passkeyApi, "list").mockResolvedValue([{ id: 1, name: "Телефон", created_at: "2026-11-06T10:00:00Z", last_used_at: "" }]);
    const register = vi.spyOn(passkeyApi, "register").mockResolvedValue({ message: "ok" });
    const remove = vi.spyOn(passkeyApi, "remove").mockResolvedValue({ message: "ok" });
    show();
    expect(await screen.findByText("Телефон")).toBeDefined();
    expect(screen.getByText(/ще не було/)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Назва пристрою"), { target: { value: "Ноутбук" } });
    fireEvent.click(screen.getByRole("button", { name: /Додати цей пристрій/ }));
    await waitFor(() => expect(register).toHaveBeenCalledWith("Ноутбук"));
    expect(await screen.findByText("Ключ доступу додано.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Видалити: Телефон" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(1));
    expect(list).toHaveBeenCalled();
  });

  it("stays quiet when the user closes the device prompt and shows other errors", async () => {
    vi.spyOn(passkeys, "passkeysSupported").mockReturnValue(true);
    vi.spyOn(passkeyApi, "list").mockResolvedValue([]);
    const register = vi.spyOn(passkeyApi, "register");
    show();
    expect(await screen.findByText("Ключів доступу ще немає.")).toBeDefined();
    register.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    fireEvent.click(screen.getByRole("button", { name: /Додати цей пристрій/ }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).toBeNull();
    register.mockRejectedValueOnce(new Error("Ліміт ключів"));
    fireEvent.click(screen.getByRole("button", { name: /Додати цей пристрій/ }));
    expect(await screen.findByText("Ліміт ключів")).toBeDefined();
  });
});
