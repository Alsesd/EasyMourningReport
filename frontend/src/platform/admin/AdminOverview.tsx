/** The hub's landing view: key figures, system health, recent activity and links to every section. */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { systemApi } from "@/platform/system/api";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import type { AdminSection } from "@/platform/modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/Card";
import { StateDot } from "@/ui/StateDot";
import { groupSections, sectionPath } from "./sections";

function Stat({ label, value, hint, to }: { label: string; value: ReactNode; hint?: string; to?: string }) {
  const body = (
    <>
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      <span className="mt-1 block text-2xl font-bold tabular-nums text-text-main">{value}</span>
      {hint && <span className="mt-0.5 block text-xs text-text-muted">{hint}</span>}
    </>
  );
  const className = "block rounded-control border border-border bg-page/40 p-4";
  return to ? (
    <Link to={to} className={`${className} transition-colors hover:border-primary/50`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function AdminOverview({ sections }: { sections: AdminSection[] }) {
  const { data, isLoading } = useQuery({ queryKey: ["adminOverview"], queryFn: () => systemApi.overview() });
  const can = (id: string) => sections.some((s) => s.id === id);
  const link = (id: string) => (can(id) ? sectionPath(id) : undefined);

  if (isLoading || !data) {
    return <p className="text-sm text-text-muted">{uk.common.loading}</p>;
  }
  const { accounts, health, tunnel, recent_activity: recent, modules = [] } = data;

  return (
    <div className="space-y-6 animate-fade-in">
      {accounts && (
        <Card>
          <CardHeader className="p-4 sm:p-5 border-b border-border">
            <CardTitle className="text-base">{uk.hub.accountsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
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
          </CardContent>
        </Card>
      )}

      {(health || tunnel) && (
        <Card>
          <CardHeader className="p-4 sm:p-5 border-b border-border">
            <CardTitle className="text-base">{uk.hub.systemTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
            {health && (
              <>
                <Stat
                  label={uk.hub.database}
                  value={
                    <span className="flex items-center gap-2 text-base">
                      <StateDot tone={health.database_ok ? "ok" : "error"} />
                      {health.database_ok ? uk.hub.databaseOk : uk.hub.databaseProblem}
                    </span>
                  }
                  hint={health.database_ok ? undefined : health.integrity}
                  to={link("backups")}
                />
                <Stat
                  label={uk.hub.lastBackup}
                  value={<span className="text-base">{health.last_backup_at ? formatDateTime(health.last_backup_at) : uk.hub.noBackups}</span>}
                  hint={uk.hub.backupsKept(health.backups_count)}
                  to={link("backups")}
                />
              </>
            )}
            {tunnel && (
              <Stat
                label={uk.hub.publicAccess}
                value={
                  <span className="flex items-center gap-2 text-base">
                    <StateDot tone={tunnel.state === "running" ? "ok" : tunnel.state === "starting" ? "busy" : tunnel.state === "error" ? "error" : "idle"} />
                    {uk.system.states[tunnel.state] ?? tunnel.state}
                  </span>
                }
                hint={tunnel.public_url || undefined}
                to={link("tunnel")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {modules.map((m) => (
        <Card key={m.module}>
          <CardHeader className="p-4 sm:p-5 border-b border-border">
            <CardTitle className="text-base">{m.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
            {m.stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} hint={s.hint || undefined} to={s.section ? link(s.section) : undefined} />
            ))}
          </CardContent>
        </Card>
      ))}

      {recent && (
        <Card>
          <CardHeader className="p-4 sm:p-5 border-b border-border flex flex-row items-center justify-between">
            <CardTitle className="text-base">{uk.hub.recentTitle}</CardTitle>
            {can("audit") && (
              <Link to={sectionPath("audit")} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-primary">
                {uk.hub.allActivity}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </CardHeader>
          <ul className="divide-y divide-border text-sm">
            {recent.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <span className="w-36 shrink-0 font-mono text-xs tabular-nums text-text-muted">{formatDateTime(entry.ts)}</span>
                <span className="font-medium text-text-main">{entry.login}</span>
                <span className="text-text-muted">{entry.action}</span>
                {entry.detail && <span className="truncate text-xs text-text-muted sm:ml-auto sm:max-w-[40%]">{entry.detail}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* On desktop the grouped menu beside the overview already lists every section. */}
      <section aria-labelledby="hub-sections" className="space-y-3 lg:hidden">
        <h2 id="hub-sections" className="text-sm font-semibold text-text-main">{uk.hub.sectionsTitle}</h2>
        {groupSections(sections).map(([group, items]) => (
          <div key={group} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{uk.hub.groups[group]}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map(({ id, label, description, icon: Icon }) => (
                <Link
                  key={id}
                  to={sectionPath(id)}
                  className="group flex items-start gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-primary/50"
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-text-main">{label}</span>
                    <span className="block text-xs text-text-muted">{description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
