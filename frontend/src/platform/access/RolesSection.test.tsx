import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RolesSection from "./RolesSection";
import { accessApi } from "./api";
import type { RoleDTO } from "@/platform/api/types";

const perms = [
  { code: "reports.submit", label: "Заповнення звіту", scope: "organisation", module: "reports", description: "d" },
  { code: "platform.audit.view", label: "Журнал дій", scope: "platform", module: "platform", description: "d" },
];
const role = (id: number, name: string, over: Partial<RoleDTO> = {}): RoleDTO =>
  ({ id, key: null, name, scope: "organisation", organisation_id: null, organisation_name: null, permissions: ["reports.submit"], built_in: false, all_permissions: false, user_count: 1, ...over }) as RoleDTO;

function show() {
  const notify = vi.fn();
  vi.spyOn(accessApi, "permissions").mockResolvedValue(perms as never);
  vi.spyOn(accessApi, "organisations").mockResolvedValue([]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RolesSection notify={notify} />
    </QueryClientProvider>,
  );
  return notify;
}

describe("RolesSection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists roles with their scope and creates a new one", async () => {
    vi.spyOn(accessApi, "roles").mockResolvedValue([role(1, "Адміністратор", { key: "platform_admin", scope: "platform", built_in: true, all_permissions: true }), role(2, "Диспетчер")]);
    const create = vi.spyOn(accessApi, "createRole").mockResolvedValue(role(3, "Нова"));
    const notify = show();
    expect(await screen.findByText("Диспетчер")).toBeDefined();
    expect(screen.getByText("Вбудована")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Створити роль/ }));
    fireEvent.change(await screen.findByLabelText("Назва ролі"), { target: { value: "Нова" } });
    fireEvent.click(screen.getByLabelText(/Заповнення звіту/));
    fireEvent.click(screen.getAllByRole("button", { name: "Створити роль" }).at(-1)!);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ name: "Нова", permissions: expect.any(Array) });
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Зміни збережено."));
  });

  it("deletes a role after a confirmation and shows server errors", async () => {
    vi.spyOn(accessApi, "roles").mockResolvedValue([role(2, "Диспетчер")]);
    const del = vi.spyOn(accessApi, "deleteRole").mockRejectedValueOnce(new Error("Роль використовується")).mockResolvedValue({ message: "ok" } as never);
    const notify = show();
    fireEvent.click(await screen.findByRole("button", { name: "Видалити роль Диспетчер" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Видалити" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Роль використовується", "err"));
    expect(del).toHaveBeenCalledWith(2);
  });
});
