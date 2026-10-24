import { Outlet, NavLink } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { uk } from "@/i18n/uk";
import { BarChart3, FileText, Settings, ShieldCheck, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminLayout() {
  const { session, logout } = useAuth();

  const navItems = [
    { to: "/admin/summary", label: uk.nav.summary, icon: BarChart3 },
    { to: "/admin/reports", label: uk.nav.reports, icon: FileText },
    { to: "/admin/settings", label: uk.nav.settings, icon: Settings },
    { to: "/admin/logs", label: uk.nav.logs, icon: ShieldCheck },
  ];

  return (
    <div className="min-h-screen bg-page text-text-main flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 border-r border-border bg-surface p-4 shrink-0">
        <div className="flex items-center justify-between pb-4 border-b border-border mb-4">
          <div>
            <h1 className="font-bold text-lg text-primary">{uk.appTitle}</h1>
            <p className="text-xs text-text-muted">{session?.login}</p>
          </div>
          <ThemeToggle />
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center px-3 py-2.5 rounded-control text-sm font-medium transition-colors min-h-[44px]",
                    isActive
                      ? "bg-primary text-primary-fg shadow-xs"
                      : "text-text-main hover:bg-page"
                  )
                }
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
            className="w-full justify-start text-destructive hover:bg-destructive/10"
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4 mr-3" />
            {uk.auth.logoutButton}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-border bg-surface sticky top-0 z-30">
          <div>
            <span className="font-bold text-primary">{uk.appTitle}</span>
            <span className="text-xs text-text-muted ml-2">({session?.login})</span>
          </div>
          <div className="flex items-center space-x-2">
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={() => logout()} aria-label={uk.auth.logoutButton}>
              <LogOut className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface flex justify-around py-1 px-2 shadow-lg">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center py-1 px-2 rounded-control text-[11px] font-medium min-h-[44px] min-w-[44px] transition-colors",
                  isActive ? "text-primary font-semibold" : "text-text-muted hover:text-text-main"
                )
              }
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
