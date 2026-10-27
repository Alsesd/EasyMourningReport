/** Route-level page registry for the reports feature. */

import { lazy } from "react";

export const reportPages = {
  StoreReportPage: lazy(() => import("./pages/StoreReportPage")),
  AdminSummaryPage: lazy(() => import("./pages/AdminSummaryPage")),
  AdminReportsPage: lazy(() => import("./pages/AdminReportsPage")),
  AdminReportDetailPage: lazy(() => import("./pages/AdminReportDetailPage")),
  AdminLogsPage: lazy(() => import("./pages/AdminLogsPage")),
  AdminSettingsPage: lazy(() => import("./pages/AdminSettingsPage")),
};

export const reportsModule = {
  id: "reports",
  basePath: "/admin/reports",
  pages: reportPages,
} as const;
