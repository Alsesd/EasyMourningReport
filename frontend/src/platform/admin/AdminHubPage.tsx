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
import { PageHeader } from "@/ui/PageHeader";
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
          "flex min-h-[44px] items-center gap-2.5 whitespace-nowrap px-3 text-[15px] transition-colors",
          // Phones: tabs underlined in spruce. Desktop: the same inset bar as the main rail.
          isActive
            ? "font-semibold text-text-main shadow-[inset_0_-2px_0_var(--primary)] lg:rounded-control lg:bg-surface-raised lg:shadow-[inset_3px_0_0_var(--primary)]"
            : "text-text-muted hover:text-text-main lg:rounded-control lg:hover:bg-surface-raised",
        )
      }
    >
      <Icon className="hidden h-4 w-4 shrink-0 lg:block" aria-hidden="true" />
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
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        crumb={current ? <Link to={HUB_PATH} className="hover:text-text-main">{uk.hub.title}</Link> : undefined}
        title={current ? current.label : uk.hub.title}
        meta={current ? current.description : uk.hub.subtitle}
      />

      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label={uk.hub.menuLabel} className="min-w-0">
          {/* Phones: one scrollable row. Desktop: grouped list. */}
          <div className="-mx-4 flex overflow-x-auto border-b border-border px-4 sm:-mx-8 sm:px-8 lg:hidden">
            <SectionLink to={HUB_PATH} end label={uk.hub.overview} icon={LayoutDashboard} />
            {sections.map((s) => (
              <SectionLink key={s.id} to={sectionPath(s.id)} label={s.label} icon={s.icon} />
            ))}
          </div>
          <div className="hidden space-y-5 lg:sticky lg:top-10 lg:block">
            <SectionLink to={HUB_PATH} end label={uk.hub.overview} icon={LayoutDashboard} />
            {grouped.map(([group, items]) => (
              <div key={group}>
                <p className="px-3 pb-1 text-sm text-text-muted">
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

        <section className="min-w-0 space-y-6" aria-label={current?.label ?? uk.hub.overview}>
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
