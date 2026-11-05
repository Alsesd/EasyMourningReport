import { useEffect } from "react";
import { Outlet, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import { ukPlatform as uk } from "@/platform/i18n";
import { navFor } from "@/app/registry";
import { BookOpen, ChevronRight } from "lucide-react";
import { AccountMenu } from "@/platform/account/AccountMenu";
import { cn } from "@/ui/utils";

export default function AdminLayout() {
  const { session } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period");

  // Navigation is composed from every installed module and filtered by the user's permissions.
  const navItems = navFor(session?.permissions).map((item) => ({
    ...item,
    basePath: item.to,
    to: item.keepPeriod && period ? `${item.to}?period=${period}` : item.to,
  }));

  const isItemActive = (basePath: string) => location.pathname.startsWith(basePath);
  const activeItem = navItems.find((item) => isItemActive(item.basePath));
  const pageTitle = activeItem?.label || uk.appTitle;

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
            <p className="mt-0.5 text-[11px] leading-snug text-[#c0d0c2]">{uk.appSubtitle}</p>
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
                key={item.id}
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
          <AccountMenu variant="sidebar" />
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
              {/* Where you are: the brand is already in the sidebar, so the bar names the current area. */}
              <p className="portal-context-label">{uk.appTitle}</p>
              <span className="block truncate text-base font-semibold tracking-tight text-text-main sm:mt-0.5 sm:text-lg">{pageTitle}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <MakerMark />
            <ThemeToggle />
            <div className="lg:hidden">
              <AccountMenu />
            </div>
          </div>
        </header>

        <main className="portal-main flex-1 animate-fade-in">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation keeps the daily destinations within thumb reach. */}
      <nav
        aria-label={uk.nav.portalLabel}
        className="portal-mobile-nav fixed bottom-0 left-0 right-0 z-40 grid gap-1 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${Math.max(navItems.length, 1)}, minmax(0, 1fr))` }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item.basePath);
          return (
            <NavLink
              key={item.id}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn("portal-mobile-link flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium", active && "font-semibold")}
            >
              <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} />
              <span className="max-w-full truncate">{item.shortLabel ?? item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
