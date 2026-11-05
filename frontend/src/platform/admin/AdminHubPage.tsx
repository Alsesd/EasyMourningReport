/**
 * «Адміністрування»: one place for access, module catalogues, system and activity.
 * Sections come from every installed module (`AppModule.admin`) and are filtered by permission.
 */

import { Suspense, useEffect, useState } from "react";
import { Link, Navigate, NavLink, useParams } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { adminSectionsFor, useModuleRegistry, type AdminSection } from "@/platform/modules";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { cn } from "@/ui/utils";
import { AdminOverview } from "./AdminOverview";
import { groupSections, HUB_PATH, sectionPath } from "./sections";

function SectionLink({ to, label, icon: Icon, end }: { to: string; label: string; icon: AdminSection["icon"]; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex min-h-[44px] items-center gap-2.5 rounded-control px-3 text-sm whitespace-nowrap transition-colors",
          isActive ? "bg-primary/10 font-semibold text-primary" : "text-text-muted hover:bg-page hover:text-text-main",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {label}
    </NavLink>
  );
}

export default function AdminHubPage() {
  const { sectionId } = useParams();
  const { session } = useAuth();
  const sections = adminSectionsFor(useModuleRegistry(), session?.permissions);
  const current = sections.find((s) => s.id === sectionId);
  const [notice, setNotice] = useState<NoticeMessage | null>(null);

  useEffect(() => setNotice(null), [sectionId]);

  if (sectionId && !current) {
    return <Navigate to={HUB_PATH} replace />;
  }
  const Section = current?.component;
  const grouped = groupSections(sections);

  return (
    <div className="space-y-6">
      <header>
        {current ? (
          <>
            <Link to={HUB_PATH} className="text-xs font-medium text-text-muted hover:text-primary">
              {uk.hub.title}
            </Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-text-main">{current.label}</h1>
            <p className="text-sm text-text-muted mt-1">{current.description}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.hub.title}</h1>
            <p className="text-sm text-text-muted mt-1">{uk.hub.subtitle}</p>
          </>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={uk.hub.menuLabel} className="min-w-0">
          {/* Phones: one scrollable row. Desktop: grouped list. */}
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:hidden">
            <SectionLink to={HUB_PATH} end label={uk.hub.overview} icon={LayoutDashboard} />
            {sections.map((s) => (
              <SectionLink key={s.id} to={sectionPath(s.id)} label={s.label} icon={s.icon} />
            ))}
          </div>
          <div className="hidden space-y-5 lg:block">
            <SectionLink to={HUB_PATH} end label={uk.hub.overview} icon={LayoutDashboard} />
            {grouped.map(([group, items]) => (
              <div key={group}>
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {uk.hub.groups[group]}
                </p>
                <div className="space-y-0.5">
                  {items.map((s) => (
                    <SectionLink key={s.id} to={sectionPath(s.id)} label={s.label} icon={s.icon} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <section className="min-w-0 space-y-4" aria-label={current?.label ?? uk.hub.overview}>
          <Notice message={notice} onDismiss={() => setNotice(null)} dismissLabel={uk.common.close} />
          {Section ? (
            <Suspense fallback={<p className="text-sm text-text-muted">{uk.common.loading}</p>}>
              <Section notify={(text, kind = "ok") => setNotice({ text, kind })} />
            </Suspense>
          ) : (
            <AdminOverview sections={sections} />
          )}
        </section>
      </div>
    </div>
  );
}
