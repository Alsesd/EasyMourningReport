import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminOverview } from "./AdminOverview";
import { systemApi } from "@/platform/system/api";
import type { AdminOverviewDTO } from "@/platform/api/types";
import type { AdminSection } from "@/platform/modules";

const section = (id: string) => ({ id } as AdminSection);
const overview = (organisations: number): AdminOverviewDTO =>
  ({ accounts: { organisations, archived_organisations: 0, users: 1, inactive_users: 0, roles: 1 }, tunnel: null, health: null, recent_activity: null, modules: [] }) as unknown as AdminOverviewDTO;

function show(data: AdminOverviewDTO, sections: string[]) {
  vi.spyOn(systemApi, "overview").mockResolvedValue(data);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AdminOverview sections={sections.map(section)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminOverview on a new installation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tells the administrator where to begin when there are no divisions", async () => {
    show(overview(0), ["organisations", "roles", "users"]);
    expect(await screen.findByRole("region", { name: "З чого почати" })).toBeDefined();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(expect.arrayContaining(["/admin/manage/organisations", "/admin/manage/roles", "/admin/manage/users"]));
  });

  it("does not show the steps once a division exists", async () => {
    show(overview(2), ["organisations", "roles", "users"]);
    await screen.findByText("Облікові записи");
    expect(screen.queryByRole("region", { name: "З чого почати" })).toBeNull();
  });
});
