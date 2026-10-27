import { Outlet, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { Button } from "@/ui/Button";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import { uk } from "@/modules/reports/i18n";
import { BarChart3, FileText, Settings, ShieldCheck, LogOut } from "lucide-react";
import { cn } from "@/ui/utils";

export default function AdminLayout() {
  const { session, logout } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const period = searchParams.get("period");

  const navItems = [
    {
      basePath: "/admin/summary",
      to: period ? `/admin/summary?period=${period}` : "/admin/summary",
      label: uk.nav.summary,
      icon: BarChart3,
    },
    {
      basePath: "/admin/reports",
      to: period ? `/admin/reports?period=${period}` : "/admin/reports",
      label: uk.nav.reports,
      icon: FileText,
    },
    {
      basePath: "/admin/settings",
      to: "/admin/settings",
      label: uk.nav.settings,
      icon: Settings,
    },
    {
      basePath: "/admin/logs",
      to: "/admin/logs",
      label: uk.nav.logs,
      icon: ShieldCheck,
    },
  ];

  const isItemActive = (basePath: string) => {
    return location.pathname.startsWith(basePath);
  };

  return (
    <div className="min-h-screen bg-page text-text-main flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-surface p-4 shrink-0 transition-colors">
        <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
          <div>
            <h1 className="font-bold text-lg text-primary">{uk.appTitle}</h1>
            <p className="text-xs text-text-muted">{session?.login}</p>
          </div>
          <div className="flex items-center space-x-1.5">
            <MakerMark />
            <ThemeToggle />
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.basePath);
            return (
              <NavLink
                key={item.basePath}
                to={item.to}
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="lg:hidden flex items-center justify-between p-3.5 border-b border-border bg-surface/95 backdrop-blur-xs sticky top-0 z-30 transition-colors">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-primary">{uk.appTitle}</span>
            <span className="text-xs text-text-muted">({session?.login})</span>
          </div>
          <div className="flex items-center space-x-2">
            <MakerMark />
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

      {/* Mobile Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/98 backdrop-blur-md flex justify-around py-1 px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-lg">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item.basePath);
          return (
            <NavLink
              key={item.basePath}
              to={item.to}
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
