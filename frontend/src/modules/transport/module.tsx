/**
 * Transport orders (scaffold). Also the template for a new module:
 * `module.tsx` (this file), `api.ts`, `permissions.ts`, `pages/`, and tests next to the pages.
 */

import { lazy } from "react";
import type { AppModule } from "@/platform/modules";
import { ANY_TRANSPORT } from "./permissions";

export const transportModule: AppModule = {
  id: "transport",
  title: "Транспорт",
  routes: [
    { path: "transport", component: lazy(() => import("./pages/TransportPage")), permissions: ANY_TRANSPORT },
  ],
  // No menu entry or landing page until orders exist: a menu item leading to a placeholder is a
  // dead end. When the orders pages land, add:
  //   nav: [{ id: "transport", to: "/admin/transport", label: uk.nav.transport, icon: Truck, permissions: ANY_TRANSPORT, order: 30 }],
  //   landing: [{ path: "/admin/transport", permissions: ANY_TRANSPORT, priority: 30 }],
};
