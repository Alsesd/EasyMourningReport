import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganisationsSection from "./OrganisationsSection";
import { accessApi } from "./api";
import { AuthProvider } from "@/platform/auth/AuthContext";
import { mockFetch } from "@/test/fetchMock";
import type { OrganisationDTO } from "@/platform/api/types";

const org = (id: number, name: string, over: Partial<OrganisationDTO> = {}): OrganisationDTO => ({ id, name, archived: false, user_count: 2, usage: { reports: 3 }, ...over }) as OrganisationDTO;
const admin = { user_id: 1, login: "admin", full_name: "", organisation: null, roles: [], permissions: ["platform.users.manage", "platform.organisations.manage"], modules: [], period: "2026-11" };

function show(notify = vi.fn()) {
  mockFetch({ "GET /api/v1/session": admin });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <MemoryRouter>
          <OrganisationsSection notify={notify} />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return notify;
}

describe("OrganisationsSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renames a division and archives it after a confirmation", async () => {
    vi.spyOn(accessApi, "organisations").mockResolvedValue([org(1, "Підрозділ А")]);
    const update = vi.spyOn(accessApi, "updateOrganisation").mockResolvedValue(org(1, "Підрозділ Б"));
    const del = vi.spyOn(accessApi, "deleteOrganisation").mockResolvedValue({ id: 1, archived: true, deleted: false, message: "Архівовано." } as never);
    const notify = show();
    const name = (await screen.findByLabelText("Назва підрозділу")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Підрозділ Б" } });
    fireEvent.click(screen.getByRole("button", { name: /Зберегти/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { name: "Підрозділ Б" }));
    fireEvent.click(screen.getByRole("button", { name: "В архів Підрозділ А" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "В архів" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(1));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Архівовано."));
  });

  it("restores an archived division and reports a failure", async () => {
    vi.spyOn(accessApi, "organisations").mockResolvedValue([org(1, "Активний"), org(2, "Старий", { archived: true })]);
    const restore = vi.spyOn(accessApi, "restoreOrganisation").mockRejectedValueOnce(new Error("Не вдалося")).mockResolvedValue(org(2, "Старий"));
    const notify = show();
    fireEvent.click(await screen.findByText(/Архів підрозділів/));
    fireEvent.click(await screen.findByRole("button", { name: /Відновити/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Не вдалося", "err"));
    fireEvent.click(screen.getByRole("button", { name: /Відновити/ }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(2));
  });

  it("opens and closes the new-division form", async () => {
    vi.spyOn(accessApi, "organisations").mockResolvedValue([]);
    vi.spyOn(accessApi, "roles").mockResolvedValue([]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Додати підрозділ/ }));
    expect(await screen.findByLabelText("Назва підрозділу")).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "Скасувати" })[0]);
    await waitFor(() => expect(screen.queryByLabelText("Назва підрозділу")).toBeNull());
  });
});
