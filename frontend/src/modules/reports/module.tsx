/** Reports module: routes, navigation, settings sections and landing pages it adds to the shell. */

import { lazy } from "react";
import { ClipboardList, FileText, Package, SlidersHorizontal } from "lucide-react";
import type { AppModule } from "@/platform/modules";
import { uk } from "./i18n";
import { RP } from "./permissions";

export const reportsModule: AppModule = {
  id: "reports",
  title: "Звіти",
  routes: [
    { path: "/report", component: lazy(() => import("./pages/StoreReportPage")), permissions: [RP.submit], layout: "standalone" },
    { path: "reports", component: lazy(() => import("./pages/ReportsMonthPage")), permissions: [RP.review] },
    // The summary used to be its own page; old links and bookmarks land on the month page.
    { path: "summary", component: lazy(() => import("./pages/SummaryRedirect")), permissions: [RP.review] },
    { path: "reports/:reportId", component: lazy(() => import("./pages/AdminReportDetailPage")), permissions: [RP.review] },
  ],
  nav: [
    { id: "report", to: "/report", label: uk.nav.storeReport, shortLabel: uk.nav.report, icon: ClipboardList, permissions: [RP.submit], order: 5 },
    { id: "reports", to: "/admin/reports", label: uk.nav.reports, icon: FileText, permissions: [RP.review], order: 10, keepPeriod: true },
  ],
  admin: [
    { id: "products", label: uk.settings.tabs.products, description: uk.settings.tabs.productsDescription, group: "catalog",
      icon: Package, permissions: [RP.catalogManage], order: 10, component: lazy(() => import("./settings/ProductsSection")) },
    { id: "report-settings", label: uk.settings.tabs.reportSettings, description: uk.settings.tabs.reportSettingsDescription,
      group: "catalog", icon: SlidersHorizontal, permissions: [RP.settingsManage], order: 20,
      component: lazy(() => import("./settings/ReportSettingsSection")) },
  ],
  landing: [
    { path: "/admin/reports", permissions: [RP.review], priority: 10 },
    { path: "/report", permissions: [RP.submit], priority: 20 },
  ],
};
