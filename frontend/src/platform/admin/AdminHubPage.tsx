/**
 * «Адміністрування»: one place for access, module catalogues, system and activity.
 * Sections come from every installed module (`AppModule.admin`) and are filtered by permission.
 */

import { SkeletonRows } from "@/ui/Skeleton";
import { Suspense, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useAuth } from "@/platform/auth/AuthContext";
import { ukPlatform as uk } from "@/platform/i18n";
import { adminSectionsFor, useModuleRegistry } from "@/platform/modules";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { PageHeader } from "@/ui/PageHeader";
import { AdminOverview } from "./AdminOverview";
import { HubSectionPicker } from "./HubNav";
import { HUB_PATH } from "./sections";

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

  return (
    <div className="mx-auto max-w-[1040px]">
      <PageHeader
        crumb={current ? <Link to={HUB_PATH} className="hover:text-text-main">{uk.hub.title}</Link> : undefined}
        title={current ? current.label : uk.hub.title}
        meta={current ? current.description : uk.hub.subtitle}
      />

      <HubSectionPicker sections={sections} current={current} />

      <div className="mt-4 lg:mt-0">
        <section className="min-w-0 space-y-6" aria-label={current?.label ?? uk.hub.overview}>
          <Notice message={notice} onDismiss={() => setNotice(null)} dismissLabel={uk.common.close} />
          {Section ? (
            <Suspense fallback={<SkeletonRows rows={4} />}>
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
