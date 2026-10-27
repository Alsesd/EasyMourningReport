import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/shared/components/ui/Button";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { MakerMark } from "@/shared/components/MakerMark";
import { uk } from "@/shared/i18n/uk";
import { cn } from "@/shared/lib/utils";
import {
  LayoutDashboard,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { permissionCatalog } from "./permissions";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

export default function WorkspaceLayout() {
  const { session, logout } = useAuth();
  const location = useLocation();
  const permissions = session?.permissions ?? [];

  const navItems: NavItem[] = [
    {
      to: "/workspace",
      label: "Огляд",
      icon: LayoutDashboard,
      match: (pathname) => pathname === "/workspace",
    },
    ...permissionCatalog
      .filter((permission) => permissions.includes(permission.code))
      .sort(
        (a, b) =>
          Number(b.code === "sales_report") - Number(a.code === "sales_report")
      )
      .map((permission) =>
        permission.code === "sales_report"
          ? {
              to: "/report",
              label: "Мій звіт",
              icon: permission.icon,
              match: (pathname: string) => pathname === "/report",
            }
          : {
              to: `/workspace/${permission.path}`,
              label: permission.shortLabel,
              icon: permission.icon,
              match: (pathname: string) =>
                pathname.startsWith(`/workspace/${permission.path}`),
            }
      ),
  ];

  const initials = (session?.name || session?.login || "?")
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-page text-text-main flex flex-col lg:flex-row">
      <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-surface p-4 shrink-0 transition-colors">
        <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
          <div className="min-w-0">
            <h1 className="font-bold text-lg text-primary truncate">{uk.appTitle}</h1>
            <p className="text-xs text-text-muted truncate">Робочий простір</p>
          </div>
          <div className="flex items-center space-x-1.5 shrink-0">
            <MakerMark />
            <ThemeToggle />
          </div>
        </div>

        <div className="mb-5 rounded-card border border-border/70 bg-page/50 p-3">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{session?.name || session?.login}</p>
              <p className="truncate text-[11px] text-text-muted">
                {session?.department_name || "Відділ не вказано"}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.match(location.pathname);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/workspace"}
                className={cn(
                  "flex items-center px-3 py-2.5 rounded-control text-sm font-medium transition-all duration-200 min-h-[44px]",
                  active
                    ? "bg-primary text-primary-fg shadow-xs font-semibold"
                    : "text-text-main hover:bg-page/70 hover:translate-x-0.5"
                )}
              >
                <Icon className="h-4 w-4 mr-3 shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-border">
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:bg-destructive/10 transition-colors"
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4 mr-3" />
            {uk.auth.logoutButton}
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="lg:hidden flex items-center justify-between p-3.5 border-b border-border bg-surface/95 backdrop-blur-xs sticky top-0 z-30 transition-colors">
          <div className="min-w-0">
            <span className="block font-bold text-primary truncate">{uk.appTitle}</span>
            <span className="block text-[11px] text-text-muted truncate">
              {session?.name || session?.login} · {session?.department_name || "без відділу"}
            </span>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              aria-label={uk.auth.logoutButton}
              className="h-9 w-9 text-destructive hover:bg-destructive/10 active:scale-95 transition-transform"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto animate-fade-in">
          <Outlet />
        </main>
      </div>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/98 backdrop-blur-md flex justify-around py-1 px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-lg">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.match(location.pathname);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/workspace"}
              className={cn(
                "flex flex-col items-center justify-center py-1 px-2 rounded-control text-[11px] font-medium min-h-[44px] min-w-[44px] transition-all active:scale-95",
                active ? "text-primary font-semibold" : "text-text-muted hover:text-text-main"
              )}
            >
              <Icon className="h-5 w-5 mb-0.5" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
