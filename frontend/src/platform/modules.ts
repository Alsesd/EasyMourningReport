/**
 * The contract every frontend feature module implements.
 *
 * A module lives in `src/modules/<name>/` and exports one `AppModule` from `module.tsx`.
 * The app shell builds routes, navigation, the landing page and the sections of the
 * «Адміністрування» hub from the list in `src/modules/index.ts`; nothing else in the shell
 * changes when a module is added.
 * Every entry names the permission codes (from the backend) that unlock it; a user needs
 * at least one of them.
 */

import { createContext, useContext, type ComponentType, type LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";

export type PageComponent = LazyExoticComponent<ComponentType> | ComponentType;

export interface ModuleRoute {
  /** Inside the workspace shell: relative to `/admin` (e.g. "summary"). Standalone: absolute (e.g. "/report"). */
  path: string;
  component: PageComponent;
  permissions: string[];
  /** "shell" renders inside the sidebar layout; "standalone" renders a full-screen page. */
  layout?: "shell" | "standalone";
}

export interface NavItem {
  id: string;
  /** Absolute path the item links to; the item is active for every path below it. */
  to: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  permissions: string[];
  /** Lower comes first. */
  order: number;
  /** Keep the selected ?period= when navigating. */
  keepPeriod?: boolean;
}

export interface AdminSectionProps {
  notify: (text: string, kind?: "ok" | "err") => void;
}

/** Where a section is listed in the hub's menu. */
export type AdminGroup = "access" | "catalog" | "system" | "activity";

export interface AdminSection {
  /** Unique across modules; also the URL: `/admin/manage/<id>`. */
  id: string;
  label: string;
  description: string;
  group: AdminGroup;
  icon: LucideIcon;
  permissions: string[];
  component: LazyExoticComponent<ComponentType<AdminSectionProps>> | ComponentType<AdminSectionProps>;
  order: number;
}

export interface LandingPage {
  path: string;
  permissions: string[];
  /** The permitted landing page with the lowest priority wins. */
  priority: number;
}

export interface AppModule {
  id: string;
  title: string;
  routes: ModuleRoute[];
  nav?: NavItem[];
  admin?: AdminSection[];
  landing?: LandingPage[];
}

/** An empty list means "any signed-in user". */
export function allowed(granted: readonly string[] | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  return Boolean(granted && required.some((code) => granted.includes(code)));
}

/** The composed module list, provided by the app shell so platform pages never import it directly. */
export const ModuleRegistryContext = createContext<AppModule[]>([]);

export function useModuleRegistry(): AppModule[] {
  return useContext(ModuleRegistryContext);
}

export function adminSectionsFor(
  modules: AppModule[],
  permissions: readonly string[] | undefined,
): AdminSection[] {
  return modules
    .flatMap((m) => m.admin ?? [])
    .filter((section) => allowed(permissions, section.permissions))
    .sort((a, b) => a.order - b.order);
}

export function navItemsFor(modules: AppModule[], permissions: readonly string[] | undefined): NavItem[] {
  return modules
    .flatMap((m) => m.nav ?? [])
    .filter((item) => allowed(permissions, item.permissions))
    .sort((a, b) => a.order - b.order);
}
