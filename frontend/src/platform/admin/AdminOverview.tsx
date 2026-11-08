/** The hub's landing view: key figures, system health and recent activity. The submenu beside it lists every section. */

import { SkeletonRows } from "@/ui/Skeleton";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { systemApi } from "@/platform/system/api";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import type { AdminSection } from "@/platform/modules";
import { LedgerSection } from "@/ui/LedgerSection";
import { Figures, StateRow, Stat, type StateTone } from "@/ui/Figures";
import { sectionPath } from "./sections";

export function AdminOverview({ sections }: { sections: AdminSection[] }) {
  const { data, isLoading } = useQuery({ queryKey: ["adminOverview"], queryFn: () => systemApi.overview() });
  const can = (id: string) => sections.some((s) => s.id === id);
  const link = (id: string) => (can(id) ? sectionPath(id) : undefined);

  if (isLoading || !data) {
    return <SkeletonRows rows={4} />;
  }
  const { accounts, health, tunnel, recent_activity: recent, modules = [] } = data;

  const tunnelTone: StateTone = tunnel?.state === "running" ? "ok" : tunnel?.state === "starting" ? "busy" : tunnel?.state === "error" ? "error" : "idle";

  // A new installation holds only the administrator: say where to begin.
  const firstSteps = accounts && accounts.organisations === 0 && (can("organisations") || can("roles"));

  return (
    <div className="space-y-10">
      {firstSteps && (
        <LedgerSection id="hub-first-steps" title={uk.hub.firstStepsTitle} description={uk.hub.firstStepsIntro}>
          <ol className="divide-y divide-border">
            {[
              { id: "organisations", text: uk.hub.firstStepDivision },
              { id: "roles", text: uk.hub.firstStepRoles },
              { id: "users", text: uk.hub.firstStepUsers },
            ]
              .filter((step) => can(step.id))
              .map((step, i) => (
                <li key={step.id}>
                  <Link to={sectionPath(step.id)} className="flex min-h-[52px] items-center gap-3 px-1 py-2.5 transition-colors hover:bg-surface-raised">
                    <span className="figure grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-sm">{i + 1}</span>
                    <span className="flex-1 text-[0.9375rem] text-text-main">{step.text}</span>
                    <ChevronRight className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  </Link>
                </li>
              ))}
          </ol>
        </LedgerSection>
      )}
      {accounts && (
        <LedgerSection id="hub-accounts" title={uk.hub.accountsTitle}>
          <Figures>
            {can("organisations") && (
              <Stat
                label={uk.hub.organisations}
                value={accounts.organisations}
                hint={uk.hub.archivedOrganisations(accounts.archived_organisations)}
                to={link("organisations")}
              />
            )}
            <Stat label={uk.hub.users} value={accounts.users} hint={uk.hub.inactiveUsers(accounts.inactive_users)} to={link("users")} />
            {can("roles") && <Stat label={uk.hub.roles} value={accounts.roles} to={link("roles")} />}
          </Figures>
        </LedgerSection>
      )}

      {modules.map((m) => (
        <LedgerSection key={m.module} id={`hub-${m.module}`} title={m.title}>
          <Figures>
            {m.stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} hint={s.hint || undefined} to={s.section ? link(s.section) : undefined} />
            ))}
          </Figures>
        </LedgerSection>
      ))}

      {(health || tunnel) && (
        <LedgerSection id="hub-system" title={uk.hub.systemTitle}>
          <div className="divide-y divide-border">
            {health && (
              <>
                <StateRow
                  label={uk.hub.database}
                  tone={health.database_ok ? "ok" : "error"}
                  state={health.database_ok ? uk.hub.databaseOk : uk.hub.databaseProblem}
                  detail={health.database_ok ? undefined : health.integrity}
                  to={link("backups")}
                />
                <StateRow
                  label={uk.hub.lastBackup}
                  tone={health.last_backup_at ? "ok" : "idle"}
                  state={health.last_backup_at ? formatDateTime(health.last_backup_at) : uk.hub.noBackups}
                  detail={uk.hub.backupsKept(health.backups_count)}
                  to={link("backups")}
                />
              </>
            )}
            {tunnel && (
              <StateRow
                label={uk.hub.publicAccess}
                tone={tunnelTone}
                state={uk.system.states[tunnel.state] ?? tunnel.state}
                detail={tunnel.public_url || undefined}
                to={link("tunnel")}
              />
            )}
          </div>
        </LedgerSection>
      )}

      {recent && (
        <LedgerSection
          id="hub-recent"
          title={uk.hub.recentTitle}
          actions={
            can("audit") && (
              <Link to={sectionPath("audit")} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary hover:underline">
                {uk.hub.allActivity}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )
          }
        >
          <ul className="divide-y divide-border text-sm">
            {recent.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 px-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="figure w-36 shrink-0 text-xs text-text-muted">{formatDateTime(entry.ts)}</span>
                <span className="font-medium text-text-main">{entry.login}</span>
                <span className="text-text-muted">{entry.action}</span>
                {entry.detail && <span className="truncate text-xs text-text-muted sm:ml-auto sm:max-w-[40%]">{entry.detail}</span>}
              </li>
            ))}
          </ul>
        </LedgerSection>
      )}
    </div>
  );
}
