import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HubRailNav } from "./HubNav";
import { adminSectionsFor } from "@/platform/modules";
import { appModules } from "@/app/registry";

const adminPermissions = [
  "platform.audit.view",
  "platform.organisations.manage",
  "platform.roles.manage",
  "platform.system.manage",
  "platform.users.manage",
  "reports.catalog.manage",
  "reports.settings.manage",
];

function renderRail(permissions: string[], path = "/admin/manage") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HubRailNav sections={adminSectionsFor(appModules, permissions)} />
    </MemoryRouter>,
  );
}

describe("HubRailNav", () => {
  it("lists every section an administrator may open, grouped", () => {
    renderRail(adminPermissions);
    const menu = screen.getByRole("navigation", { name: "Розділи адміністрування" });
    for (const label of ["Огляд", "Користувачі", "Організації", "Ролі", "Товари й ціни", "Звіти організацій", "Публічний доступ", "Резервні копії", "Журнал дій"]) {
      expect(within(menu).getByRole("link", { name: label })).toBeDefined();
    }
    for (const group of ["Доступ", "Система", "Активність"]) expect(within(menu).getByText(group)).toBeDefined();
  });

  it("offers an organisation admin only the users section", () => {
    renderRail(["org.users.manage", "reports.submit"]);
    const menu = screen.getByRole("navigation", { name: "Розділи адміністрування" });
    expect(within(menu).getAllByRole("link").map((l) => l.textContent)).toEqual(["Огляд", "Користувачі"]);
  });

  it("marks the open section as current", () => {
    renderRail(adminPermissions, "/admin/manage/roles");
    const link = screen.getByRole("link", { name: "Ролі" });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Огляд" }).getAttribute("aria-current")).toBeNull();
  });
});
