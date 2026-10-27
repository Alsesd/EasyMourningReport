import { useEffect } from "react";
import { Outlet, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { Button } from "@/ui/Button";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import { uk } from "@/modules/reports/i18n";
import { BarChart3, FileText, Settings, ShieldCheck, LogOut, BookOpen, ChevronRight } from "lucide-react";
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

  const isItemActive = (basePath: string) => location.pathname.startsWith(basePath);
  const activeItem = navItems.find((item) => isItemActive(item.basePath));
  const pageTitle = location.pathname.match(/^\/admin\/reports\/[^/]+/) ? uk.reports.detailTitle : (activeItem?.label || uk.nav.summary);

  useEffect(() => {
    document.title = `${pageTitle} — ${uk.appTitle}`;
  }, [pageTitle]);

  const navClass = (active: boolean) => cn(
    "portal-nav-link flex w-full items-center gap-3 rounded-control px-3.5 py-3 text-sm font-medium",
    active && "font-semibold"
  );

  return (
    <div className="portal-shell min-h-screen flex flex-col lg:flex-row text-text-main">
      {/* Desktop workspace rail */}
      <aside className="portal-sidebar hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[258px] lg:flex-col lg:shrink-0 lg:px-4 lg:py-5">
        <div className="flex items-center gap-3 px-2 pb-6">
          <div className="portal-brand-mark" aria-hidden="true">
            <BookOpen className="h-5 w-5" strokeWidth={1.7} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-tight text-[#fffefa]">{uk.appTitle}</p>
            <p className="mt-0.5 truncate text-[11px] text-[#c0d0c2]">{uk.appSubtitle}</p>
          </div>
        </div>

        <div className="mx-2 mb-3 border-t border-white/10 pt-5">
          <p className="portal-sidebar-eyebrow">{uk.nav.workspaceLabel}</p>
        </div>

        <nav aria-label={uk.nav.portalLabel} className="flex-1 space-y-1 px-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.basePath);
            return (
              <NavLink
                key={item.basePath}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={navClass(active)}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                <span className="flex-1">{item.label}</span>
                {active && <ChevronRight className="h-4 w-4 opacity-70" aria-hidden="true" />}
              </NavLink>
            );
          })}
        </nav>

        <div className="portal-sidebar-footer mx-1 mt-5 pt-4">
          <div className="mb-3 flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-xs font-semibold text-[#e4d1aa]">
              {(session?.login || "A").slice(0, 1).toLocaleUpperCase("uk-UA")}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#f1f2e9]">{session?.login}</p>
              <p className="mt-0.5 text-[10px] tracking-wide text-[#afc1b2]">{uk.auth.secureAccess}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="portal-logout w-full justify-start text-[#e6b5a8] hover:text-[#fffefa]"
            onClick={() => logout()}
          >
            <LogOut className="mr-3 h-4 w-4" />
            {uk.auth.logoutButton}
          </Button>
          <div className="mt-5 flex items-center justify-between px-2 text-[10px] tracking-wide text-[#97ad9e]">
            <span>{uk.appTitle}</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </aside>

      {/* Main application surface */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="portal-topbar sticky top-0 z-30 flex min-h-[68px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="portal-brand-mark h-10 w-10 lg:hidden" aria-hidden="true">
              <BookOpen className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </div>
            <div className="min-w-0">
              <p className="portal-context-label hidden sm:block">{uk.nav.portalLabel}</p>
              <span className="block truncate text-base font-semibold tracking-tight text-text-main sm:mt-0.5 sm:text-lg">{uk.appTitle}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="portal-session-pill hidden sm:inline-flex">
              <span className="portal-session-dot" aria-hidden="true" />
              <span className="max-w-[150px] truncate">{session?.login}</span>
            </div>
            <MakerMark className="hidden sm:inline-flex" />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              aria-label={uk.auth.logoutButton}
              title={uk.auth.logoutButton}
              className="portal-mobile-logout h-10 w-10 text-text-muted hover:text-destructive lg:hidden"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="portal-main flex-1 animate-fade-in">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation keeps the four daily destinations within thumb reach. */}
      <nav aria-label={uk.nav.portalLabel} className="portal-mobile-nav fixed bottom-0 left-0 right-0 z-40 grid grid-cols-4 gap-1 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item.basePath);
          return (
            <NavLink
              key={item.basePath}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn("portal-mobile-link flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium", active && "font-semibold")}
            >
              <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} />
              <span>{item.basePath === "/admin/settings" ? uk.nav.settingsShort : item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
