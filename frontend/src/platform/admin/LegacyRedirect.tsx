import { Navigate, useLocation } from "react-router-dom";
import { HUB_PATH, sectionPath } from "./sections";

const TAB_TO_SECTION: Record<string, string> = {
  users: "users",
  organisations: "organisations",
  roles: "roles",
  products: "products",
  "report-settings": "report-settings",
  tunnel: "tunnel",
  backup: "backups",
};

/** Old bookmarks (/admin/access, /admin/settings?tab=…, /admin/logs) land on the matching hub section. */
export default function LegacyRedirect() {
  const { pathname, search } = useLocation();
  if (pathname.endsWith("/logs")) return <Navigate to={sectionPath("audit")} replace />;
  const tab = new URLSearchParams(search).get("tab");
  const fallback = pathname.endsWith("/access") ? "users" : null;
  const section = (tab && TAB_TO_SECTION[tab]) || fallback;
  return <Navigate to={section ? sectionPath(section) : HUB_PATH} replace />;
}
