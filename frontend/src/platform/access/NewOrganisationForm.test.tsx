import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewOrganisationForm, generatePassword, type CreateOutcome } from "./NewOrganisationForm";

const roles = [
  { id: 1, key: "platform_admin", name: "Адміністратор", scope: "platform", organisation_id: null },
  { id: 2, key: "org_admin", name: "Адміністратор організації", scope: "organisation", organisation_id: null },
  { id: 3, key: "store", name: "Магазин", scope: "organisation", organisation_id: null },
  { id: 4, key: null, name: "Лише для старої", scope: "organisation", organisation_id: 9 },
];
const users = [
  { id: 5, login: "olena", full_name: "Олена", active: true, organisation: { id: 9, name: "Стара" }, role_ids: [4, 3] },
  { id: 6, login: "boss", full_name: "", active: true, organisation: null, role_ids: [1] },
];

type Call = { url: string; method: string; body: unknown };

function json(data: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
}

describe("NewOrganisationForm", () => {
  let calls: Call[];
  let done: ReturnType<typeof vi.fn>;
  let failUserCreate: string | null;

  beforeEach(() => {
    calls = [];
    done = vi.fn();
    failUserCreate = null;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      if (url.includes("/api/v1/roles")) return json(roles);
      if (url.includes("/api/v1/users") && method === "GET") return json(users);
      if (url.endsWith("/api/v1/organisations") && method === "POST") return json({ id: 20, name: body.name, archived: false, user_count: 0, usage: {} }, 201);
      if (url.endsWith("/api/v1/users") && method === "POST") {
        if (failUserCreate && body.login === failUserCreate) return json({ detail: "Логін зайнятий." }, 409);
        return json({ id: 99, ...body }, 201);
      }
      if (/\/api\/v1\/users\/\d+$/.test(url) && method === "PUT") return json({ id: 5, ...body }, 200);
      return Promise.reject(new Error("Unknown route: " + method + " " + url));
    });
  });

  function renderForm() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <NewOrganisationForm canManageUsers onDone={done as unknown as (o: CreateOutcome) => void} onCancel={() => {}} />
      </QueryClientProvider>,
    );
  }
  const posts = (suffix: string) => calls.filter((c) => c.method === "POST" && c.url.endsWith(suffix));

  it("creates an organisation with no employees at all", async () => {
    renderForm();
    expect(screen.getByText(/Необов'язково/)).toBeDefined();
    expect(screen.queryByLabelText("Логін")).toBeNull(); // no employee row is forced on the user
    await userEvent.type(screen.getByLabelText("Назва підрозділу"), "Філія Північ");
    fireEvent.click(screen.getByRole("button", { name: "Створити підрозділ" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(posts("/api/v1/organisations")[0].body).toEqual({ name: "Філія Північ", first_user: null });
    expect(posts("/api/v1/users")).toHaveLength(0);
    expect(done.mock.calls[0][0]).toMatchObject({ created: 0, moved: 0, failures: [] });
  });

  it("creates several employees with their roles after the organisation", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Назва підрозділу"), "Філія Південь");
    fireEvent.click(screen.getByRole("button", { name: "Додати працівника" }));
    fireEvent.click(screen.getByRole("button", { name: "Додати працівника" }));
    const logins = await screen.findAllByLabelText("Логін");
    const passwords = screen.getAllByLabelText("Пароль");
    await userEvent.type(logins[0], "anna");
    await userEvent.type(passwords[0], "Long-enough-1");
    await userEvent.type(logins[1], "petro");
    await userEvent.type(passwords[1], "Long-enough-2");
    await waitFor(() => expect((screen.getAllByLabelText("Роль")[0] as HTMLSelectElement).options.length).toBe(2)); // only shared organisation roles
    fireEvent.change(screen.getAllByLabelText("Роль")[1], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Створити підрозділ" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const users = posts("/api/v1/users").map((c) => c.body);
    expect(users).toEqual([
      expect.objectContaining({ login: "anna", organisation_id: 20, role_ids: [3] }), // the "Магазин" role is the default
      expect.objectContaining({ login: "petro", organisation_id: 20, role_ids: [2] }),
    ]);
    expect(done.mock.calls[0][0]).toMatchObject({ created: 2, failures: [] });
  });

  it("ignores blank rows and refuses short passwords before calling the server", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Назва підрозділу"), "Філія");
    fireEvent.click(screen.getByRole("button", { name: "Додати працівника" }));
    fireEvent.click(screen.getByRole("button", { name: "Створити підрозділ" })); // blank row: fine
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));

    done.mockClear();
    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Додати працівника" }));
    await userEvent.type((await screen.findAllByLabelText("Логін")).at(-1)!, "ivan");
    await userEvent.type(screen.getAllByLabelText("Пароль").at(-1)!, "short");
    fireEvent.click(screen.getByRole("button", { name: "Створити підрозділ" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("щонайменше 8 символів"));
    expect(posts("/api/v1/organisations")).toHaveLength(0);
  });

  it("keeps the organisation and reports the employee that could not be created", async () => {
    failUserCreate = "taken";
    renderForm();
    await userEvent.type(screen.getByLabelText("Назва підрозділу"), "Філія Захід");
    fireEvent.click(screen.getByRole("button", { name: "Додати працівника" }));
    await userEvent.type((await screen.findAllByLabelText("Логін"))[0], "taken");
    await userEvent.type(screen.getAllByLabelText("Пароль")[0], "Long-enough-1");
    fireEvent.click(screen.getByRole("button", { name: "Створити підрозділ" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(done.mock.calls[0][0].failures).toEqual(["taken: Логін зайнятий."]);
    expect(done.mock.calls[0][0].organisation.id).toBe(20);
  });

  it("generates a password that satisfies the minimum and shows it", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Додати працівника" }));
    const field = (await screen.findAllByLabelText("Пароль"))[0] as HTMLInputElement;
    expect(field.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Згенерувати пароль" }));
    expect(field.value.length).toBeGreaterThanOrEqual(10);
    expect(field.type).toBe("text");
    expect(generatePassword()).toMatch(/^[A-Za-z2-9]{12}$/);
    for (let i = 0; i < 100; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[0-9]/);
    }
    expect(generatePassword()).not.toBe(generatePassword());
  });

  it("moves selected existing employees into the new organisation, keeping only roles that can follow", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText("Назва підрозділу"), "Нова філія");
    fireEvent.click(screen.getByRole("button", { name: "Перенести наявних працівників" }));
    expect(await screen.findByText("olena")).toBeDefined();
    expect(screen.queryByText("boss")).toBeNull(); // platform staff are not offered
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Створити підрозділ" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toMatch(/\/api\/v1\/users\/5$/);
    expect(put.body).toEqual({ login: "olena", full_name: "Олена", organisation_id: 20, role_ids: [3], active: true });
    expect(done.mock.calls[0][0]).toMatchObject({ moved: 1, failures: [] });
  });
});

describe("NewOrganisationForm without any division role", () => {
  it("tells the administrator to create a role first", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.includes("/roles") ? [{ id: 1, key: "platform_admin", name: "Адміністратор", scope: "platform", organisation_id: null }] : []) }),
    ) as unknown as typeof fetch;
    try {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <NewOrganisationForm canManageUsers onDone={() => {}} onCancel={() => {}} />
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Додати працівника" }));
      expect(await screen.findByText(/спершу створіть роль/)).toBeDefined();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
