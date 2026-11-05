import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UsersSection from "./UsersSection";
import { AuthProvider } from "@/platform/auth/AuthContext";
import type { RoleDTO, SessionDTO, UserDTO } from "@/platform/api/types";

const orgAdmin: SessionDTO = {
  user_id: 10,
  login: "manager",
  full_name: "",
  organisation: { id: 3, name: "Магазин Центр" },
  roles: ["Адміністратор організації"],
  permissions: ["org.users.manage", "reports.submit"],
  modules: ["platform", "reports"],
  period: "2026-10",
};

const platformAdmin: SessionDTO = {
  ...orgAdmin,
  user_id: 1,
  login: "admin",
  organisation: null,
  roles: ["Адміністратор"],
  permissions: ["platform.users.manage", "platform.organisations.manage", "platform.roles.manage"],
};

const users: UserDTO[] = [
  { id: 10, login: "manager", full_name: "", active: true, organisation: { id: 3, name: "Магазин Центр" }, role_ids: [2], role_names: ["Адміністратор організації"] },
  { id: 11, login: "clerk", full_name: "Олена", active: false, organisation: { id: 3, name: "Магазин Центр" }, role_ids: [3], role_names: ["Магазин"] },
];

const roles: RoleDTO[] = [
  { id: 2, key: "org_admin", name: "Адміністратор організації", scope: "organisation", permissions: ["org.users.manage", "reports.submit"], built_in: true, all_permissions: true, user_count: 1 },
  { id: 3, key: "store", name: "Магазин", scope: "organisation", permissions: ["reports.submit"], built_in: true, all_permissions: false, user_count: 1 },
];

function json(data: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
}

describe("UsersSection", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/users") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        return json({ id: 12, login: body.login, full_name: "", active: true, organisation: { id: 3, name: "Магазин Центр" }, role_ids: body.role_ids, role_names: ["Магазин"] }, 201);
      }
      if (url.includes("/api/v1/users")) return json(users);
      if (url.includes("/api/v1/roles")) return json(roles);
      if (url.includes("/api/v1/organisations")) return json([]);
      if (url.includes("/api/v1/permissions")) return json([]);
      return Promise.reject(new Error("Unknown route: " + url));
    });
  });

  function renderPage(session: SessionDTO) {
    queryClient.setQueryData(["session"], session);
    return render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter>
            <UsersSection notify={vi.fn()} />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  it("shows an organisation admin only their organisation's users", async () => {
    renderPage(orgAdmin);
    expect(await screen.findByText("clerk")).toBeDefined();
    expect(screen.getByText("Вимкнено")).toBeDefined();
    // No organisation picker: the server always uses the manager's own organisation.
    expect(screen.queryByLabelText("Організація")).toBeNull();
  });

  it("creates a user with the chosen role", async () => {
    renderPage(orgAdmin);
    await screen.findByText("clerk");
    fireEvent.click(screen.getByRole("button", { name: /Додати користувача/ }));
    const form = screen.getByText("Новий користувач").closest("div")!.parentElement!;
    fireEvent.change(within(form).getByLabelText("Логін"), { target: { value: "helper" } });
    fireEvent.change(within(form).getByLabelText("Пароль"), { target: { value: "helper-pass" } });
    fireEvent.click(within(form).getByLabelText("Магазин"));
    fireEvent.click(within(form).getByRole("button", { name: "Додати користувача" }));

    await waitFor(() => {
      const post = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
        login: "helper",
        password: "helper-pass",
        organisation_id: 3,
        role_ids: [3],
        active: true,
      });
    });
  });

  it("lets a platform admin pick the organisation", async () => {
    renderPage(platformAdmin);
    expect(await screen.findByLabelText("Організація")).toBeDefined();
  });
});
