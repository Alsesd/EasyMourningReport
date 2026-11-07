/** The platform's own pages, declared with the same contract as feature modules. */

import { lazy } from "react";
import { Activity, Building2, Database, Download, Globe, KeySquare, MonitorSmartphone, ScrollText, ShieldCheck, Users } from "lucide-react";
import { P } from "@/platform/access/api";
import { ukPlatform as uk } from "@/platform/i18n";
import type { AppModule } from "@/platform/modules";

const s = uk.access.sections;
const legacy = lazy(() => import("./admin/LegacyRedirect"));

export const platformModule: AppModule = {
  id: "platform",
  title: "Платформа",
  routes: [
    // The hub decides per section who may open it; the route only needs a signed-in user.
    { path: "manage", component: lazy(() => import("./admin/AdminHubPage")), permissions: [] },
    { path: "manage/:sectionId", component: lazy(() => import("./admin/AdminHubPage")), permissions: [] },
    { path: "home", component: lazy(() => import("./admin/NoAccessPage")), permissions: [] },
    { path: "access", component: legacy, permissions: [] },
    { path: "settings", component: legacy, permissions: [] },
    { path: "logs", component: legacy, permissions: [] },
  ],
  nav: [
    // Shown when the user may open at least one hub section (permissions filled in by app/registry.ts).
    { id: "admin", to: "/admin/manage", label: uk.nav.admin, shortLabel: uk.nav.adminShort, icon: ShieldCheck, permissions: [], order: 90 },
  ],
  admin: [
    { id: "users", label: s.users, description: s.usersDescription, group: "access", icon: Users,
      permissions: [P.usersManage, P.orgUsersManage], order: 10, component: lazy(() => import("./access/UsersSection")) },
    { id: "organisations", label: s.organisations, description: s.organisationsDescription, group: "access", icon: Building2,
      permissions: [P.organisationsManage], order: 20, component: lazy(() => import("./access/OrganisationsSection")) },
    { id: "sessions", label: s.sessions, description: s.sessionsDescription, group: "access", icon: MonitorSmartphone,
      permissions: [P.usersManage], order: 25, component: lazy(() => import("./access/SessionsSection")) },
    { id: "roles", label: s.roles, description: s.rolesDescription, group: "access", icon: KeySquare,
      permissions: [P.rolesManage], order: 30, component: lazy(() => import("./access/RolesSection")) },
    { id: "health", label: uk.system.healthTab, description: uk.system.healthDescription, group: "system", icon: Activity,
      permissions: [P.systemManage], order: 5, component: lazy(() => import("./system/HealthSection")) },
    { id: "tunnel", label: uk.system.tunnelTab, description: uk.system.tunnelDescription, group: "system", icon: Globe,
      permissions: [P.systemManage], order: 10, component: lazy(() => import("./system/TunnelSection")) },
    { id: "update", label: uk.system.updateTab, description: uk.system.updateDescription, group: "system", icon: Download,
      permissions: [P.systemManage], order: 15, component: lazy(() => import("./system/UpdateSection")) },
    { id: "backups", label: uk.system.backupTab, description: uk.system.backupDescription, group: "system", icon: Database,
      permissions: [P.systemManage], order: 20, component: lazy(() => import("./system/BackupSection")) },
    { id: "audit", label: s.audit, description: s.auditDescription, group: "activity", icon: ScrollText,
      permissions: [P.auditView], order: 10, component: lazy(() => import("./audit/AuditLogSection")) },
  ],
  landing: [
    { path: "/admin/manage", permissions: [P.usersManage, P.orgUsersManage, P.organisationsManage, P.rolesManage, P.systemManage, P.auditView], priority: 50 },
    { path: "/admin/home", permissions: [], priority: 100 },
  ],
};
