/** Every module the shell composes: the platform's own pages first, then installed feature modules. */

import { installedModules } from "@/modules";
import { platformModule } from "@/platform/platformModule";
import { navItemsFor, type AppModule, type NavItem } from "@/platform/modules";

export const appModules: AppModule[] = [platformModule, ...installedModules];

export function navFor(permissions: readonly string[] | undefined): NavItem[] {
  return navItemsFor(appModules, permissions);
}
