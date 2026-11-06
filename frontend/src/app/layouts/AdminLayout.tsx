import { useEffect } from "react";
import { Outlet, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import { ukPlatform as uk } from "@/platform/i18n";
import { navFor } from "@/app/registry";
import { AccountMenu } from "@/platform/account/AccountMenu";
import { HubRailNav } from "@/platform/admin/HubNav";
import { HUB_PATH } from "@/platform/admin/sections";
import { adminSectionsFor, useModuleRegistry } from "@/platform/modules";
import { cn } from "@/ui/utils";

/** The record book's monogram: the two initials of «Легкий звіт» in the book serif. */
function Monogram({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-control bg-primary font-serif text-[15px] font-semibold text-primary-fg", className)}
    >
      ЛЗ
    </span>
  );
}

export default function AdminLayout() {
  const { session } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period");

  const hubSections = adminSectionsFor(useModuleRegistry(), session?.permissions);

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

  return (
    <div className="flex min-h-screen flex-col text-text-main lg:flex-row">
      {/* Desktop rail: brand, the modules' pages, then who is signed in. */}
      <aside className="hidden border-r border-border bg-surface-raised lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[240px] lg:shrink-0 lg:flex-col">
        <div className="flex items-center gap-3 px-5 pb-6 pt-6">
          <Monogram />
          <div className="min-w-0">
            <p className="font-serif text-[17px] font-semibold leading-tight text-text-main">{uk.appTitle}</p>
            <p className="text-xs leading-snug text-text-muted">{uk.appSubtitle}</p>
          </div>
        </div>

        <nav aria-label={uk.nav.portalLabel} className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(item.basePath);
            return (
              <div key={item.id}>
                <NavLink
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-3 rounded-control px-3 text-[15px] transition-colors",
                    active
                      ? "bg-surface font-semibold text-text-main shadow-[inset_3px_0_0_var(--primary)]"
                      : "text-text-muted hover:bg-surface/70 hover:text-text-main",
                  )}
                >
                  <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} strokeWidth={1.8} aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                </NavLink>
                {item.basePath === HUB_PATH && active && hubSections.length > 0 && <HubRailNav sections={hubSections} />}
              </div>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-border px-3 py-4">
          <AccountMenu variant="sidebar" />
          <div className="flex items-center justify-between gap-2 px-1">
            <ThemeToggle />
            <MakerMark />
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">
        {/* Narrow screens: a slim bar with the brand and the personal controls. */}
        <header className="sticky top-0 z-30 flex min-h-[60px] items-center justify-between gap-3 border-b border-border bg-page/95 px-4 lg:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <Monogram className="h-8 w-8 text-sm" />
            <span className="truncate font-serif text-base font-semibold">{uk.appTitle}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <MakerMark />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        <main className="flex-1 px-4 pb-12 pt-6 sm:px-8 lg:px-12 lg:pt-10">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation keeps the daily destinations within thumb reach. */}
      <nav
        aria-label={uk.nav.portalLabel}
        className="fixed bottom-0 left-0 right-0 z-40 grid border-t border-border bg-surface px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
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
              className={cn(
                "flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs",
                active ? "font-semibold text-primary shadow-[inset_0_2px_0_var(--primary)]" : "text-text-muted",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              <span className="max-w-full truncate">{item.shortLabel ?? item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
