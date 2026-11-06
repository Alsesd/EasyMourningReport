/** Every module the shell composes: the platform's own pages first, then installed feature modules. */

import { installedModules } from "@/modules";
import { platformModule } from "@/platform/platformModule";
import { navItemsFor, type AppModule, type NavItem } from "@/platform/modules";

const composed: AppModule[] = [platformModule, ...installedModules];

/** Every permission that opens at least one «Адміністрування» section, from any module. */
export const adminPermissions = [...new Set(composed.flatMap((m) => m.admin ?? []).flatMap((s) => s.permissions))];

// The hub's menu item appears for anyone who can open one of its sections.
export const appModules: AppModule[] = composed.map((m) => ({
  ...m,
  nav: m.nav?.map((item) => (item.id === "admin" ? { ...item, permissions: adminPermissions } : item)),
}));

export function navFor(permissions: readonly string[] | undefined): NavItem[] {
  return navItemsFor(appModules, permissions);
}
