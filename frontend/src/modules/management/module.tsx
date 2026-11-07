/**
 * Management dashboard: business figures for the people who run the business. The page holds no data of its own:
 * the server collects the blocks from the other modules, and one view-only permission decides who sees them.
 */

import { lazy } from "react";
import { BarChart3 } from "lucide-react";
import type { AppModule } from "@/platform/modules";
import { uk } from "./i18n";
import { MP } from "./permissions";

export const managementModule: AppModule = {
  id: "management",
  title: "Керівництво",
  routes: [{ path: "dashboard", component: lazy(() => import("./pages/DashboardPage")), permissions: [MP.view] }],
  nav: [{ id: "dashboard", to: "/admin/dashboard", label: uk.nav.dashboard, shortLabel: uk.nav.dashboardShort, icon: BarChart3, permissions: [MP.view], order: 60 }],
  // A user who holds only this permission has no other page to land on.
  landing: [{ path: "/admin/dashboard", permissions: [MP.view], priority: 40 }],
};
