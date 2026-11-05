/** The platform's own pages, declared with the same contract as feature modules. */

import { lazy } from "react";
import { Database, Globe, KeyRound, Settings, ShieldCheck, Users } from "lucide-react";
import { P } from "@/platform/access/api";
import { ukPlatform as uk } from "@/platform/i18n";
import type { AppModule } from "@/platform/modules";

const ACCOUNT_MANAGERS = [P.usersManage, P.orgUsersManage, P.rolesManage, P.organisationsManage];

export const platformModule: AppModule = {
  id: "platform",
  title: "Платформа",
  routes: [
    { path: "access", component: lazy(() => import("./access/AccessPage")), permissions: ACCOUNT_MANAGERS },
    { path: "settings", component: lazy(() => import("./settings/SettingsPage")), permissions: [] },
    { path: "logs", component: lazy(() => import("./audit/AuditLogPage")), permissions: [P.auditView] },
  ],
  nav: [
    { id: "access", to: "/admin/access", label: uk.nav.access, shortLabel: uk.nav.accessShort, icon: Users, permissions: ACCOUNT_MANAGERS, order: 80 },
    { id: "settings", to: "/admin/settings", label: uk.nav.settings, shortLabel: uk.nav.settingsShort, icon: Settings, permissions: [], order: 90 },
    { id: "logs", to: "/admin/logs", label: uk.nav.logs, icon: ShieldCheck, permissions: [P.auditView], order: 95 },
  ],
  settings: [
    { id: "tunnel", label: uk.system.tunnelTab, icon: Globe, permissions: [P.systemManage], order: 80,
      component: lazy(() => import("./system/TunnelSection")) },
    { id: "backup", label: uk.system.backupTab, icon: Database, permissions: [P.systemManage], order: 85,
      component: lazy(() => import("./system/BackupSection")) },
    { id: "account", label: uk.account.tab, icon: KeyRound, permissions: [], order: 99,
      component: lazy(() => import("./settings/AccountSection")) },
  ],
  landing: [
    { path: "/admin/access", permissions: [P.usersManage, P.orgUsersManage], priority: 50 },
    { path: "/admin/settings", permissions: [], priority: 100 },
  ],
};
