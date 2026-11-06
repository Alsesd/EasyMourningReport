/**
 * Transport orders: desks fill in the day's table, dispatchers answer. Also the template for a new module:
 * `module.tsx` (this file), `api.ts`, `permissions.ts`, `pages/`, and tests next to the pages.
 */

import { lazy } from "react";
import { Truck } from "lucide-react";
import type { AppModule } from "@/platform/modules";
import { uk } from "./i18n";
import { ANY_TRANSPORT } from "./permissions";

export const transportModule: AppModule = {
  id: "transport",
  title: "Транспорт",
  routes: [{ path: "transport", component: lazy(() => import("./pages/TransportPage")), permissions: ANY_TRANSPORT }],
  nav: [{ id: "transport", to: "/admin/transport", label: uk.nav.transport, icon: Truck, permissions: ANY_TRANSPORT, order: 30 }],
  landing: [{ path: "/admin/transport", permissions: ANY_TRANSPORT, priority: 30 }],
};
