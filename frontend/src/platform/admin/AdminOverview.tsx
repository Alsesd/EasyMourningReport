/** The hub's landing view: key figures, system health and recent activity. The submenu beside it lists every section. */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { systemApi } from "@/platform/system/api";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import type { AdminSection } from "@/platform/modules";
import { LedgerSection } from "@/ui/LedgerSection";
import { StateDot } from "@/ui/StateDot";
import { sectionPath } from "./sections";

/** One figure of the dashboard: the number in the book serif, its label beneath, a link if it leads somewhere. */
function Stat({ label, value, hint, to }: { label: string; value: ReactNode; hint?: string; to?: string }) {
  const body = (
    <>
      <span className="figure block text-[30px] leading-tight text-text-main">{value}</span>
      <span className="mt-0.5 block text-sm text-text-main">{label}</span>
      {hint && <span className="block break-words text-xs text-text-muted">{hint}</span>}
    </>
  );
  const className = "block min-w-0 px-1 py-4 sm:px-5 sm:first:pl-1";
  return to ? (
    <Link to={to} className={`${className} transition-colors hover:bg-surface-raised`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A row of figures separated by thin rules; stacks into ruled rows on phones. */
function Figures({ children }: { children: ReactNode }) {
  return <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">{children}</div>;
}

/** A state line: what it is, a status light with its word, and a detail. */
function StateRow({ label, tone, state, detail, to }: { label: string; tone: StateTone; state: string; detail?: string; to?: string }) {
  const body = (
    <>
      <span className="w-full text-sm text-text-muted sm:w-48 sm:shrink-0">{label}</span>
      <span className="flex items-center gap-2 font-medium text-text-main">
        <StateDot tone={tone} />
        {state}
      </span>
      {detail && <span className="min-w-0 break-words text-sm text-text-muted sm:ml-auto sm:text-right">{detail}</span>}
    </>
  );
  const className = "flex flex-wrap items-center gap-x-4 gap-y-0.5 px-1 py-3";
  return to ? (
    <Link to={to} className={`${className} transition-colors hover:bg-surface-raised`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

type StateTone = "ok" | "busy" | "error" | "idle";

export function AdminOverview({ sections }: { sections: AdminSection[] }) {
  const { data, isLoading } = useQuery({ queryKey: ["adminOverview"], queryFn: () => systemApi.overview() });
  const can = (id: string) => sections.some((s) => s.id === id);
  const link = (id: string) => (can(id) ? sectionPath(id) : undefined);

  if (isLoading || !data) {
    return <p className="text-sm text-text-muted">{uk.common.loading}</p>;
  }
  const { accounts, health, tunnel, recent_activity: recent, modules = [] } = data;

  const tunnelTone: StateTone = tunnel?.state === "running" ? "ok" : tunnel?.state === "starting" ? "busy" : tunnel?.state === "error" ? "error" : "idle";

  return (
    <div className="space-y-10">
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
