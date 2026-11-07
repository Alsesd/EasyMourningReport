/** «Стан програми»: technical health for the administrator. Business figures live on the management dashboard. */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { systemApi } from "@/platform/system/api";
import { formatBytes } from "@/platform/system/BackupSection";
import { backupTone, diskTone, formatUptime, httpTone, issues, jobTone } from "@/platform/system/healthStatus";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import { Button } from "@/ui/Button";
import { Figures, StateRow, Stat, type StateTone } from "@/ui/Figures";
import { LedgerSection } from "@/ui/LedgerSection";
import { StateDot } from "@/ui/StateDot";

const h = uk.system.health;
const REFRESH_MS = 30000;

export default function HealthSection() {
  const queryClient = useQueryClient();
  const { data: m, isLoading, isError } = useQuery({ queryKey: ["systemMetrics"], queryFn: () => systemApi.metrics(), refetchInterval: REFRESH_MS });
  const { data: tunnel } = useQuery({ queryKey: ["tunnel"], queryFn: () => systemApi.tunnel(), refetchInterval: REFRESH_MS });
  const { data: upd } = useQuery({ queryKey: ["update"], queryFn: () => systemApi.update(), refetchInterval: REFRESH_MS });
  const [logLevel, setLogLevel] = useState<"" | "error" | "warning">("");
  const { data: logs } = useQuery({ queryKey: ["systemLogs", logLevel], queryFn: () => systemApi.logs(logLevel), refetchInterval: REFRESH_MS });
  const recheck = useMutation({
    mutationFn: () => systemApi.recheckIntegrity(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["systemMetrics"] }),
  });

  if (isLoading) return <p className="text-sm text-text-muted">{uk.common.loading}</p>;
  if (isError || !m) return <p className="text-sm text-destructive">{uk.common.error}</p>;

  const problems = issues(m);
  const tunnelTone: StateTone = tunnel?.state === "running" ? "ok" : tunnel?.state === "starting" ? "busy" : tunnel?.state === "error" ? "error" : "idle";
  const backupState = !m.backups.configured
    ? h.backupNotConfigured
    : m.backups.last_error
      ? h.backupJobFailed
      : m.backups.run_overdue
        ? h.backupJobLate
        : h.backupJobOk;

  return (
    <div className="space-y-10">
      <div role="status" className="flex flex-wrap items-center gap-3">
        <StateDot tone={problems.length === 0 ? "ok" : "error"} className="h-3 w-3" />
        <span className="text-lg font-semibold text-text-main">{problems.length === 0 ? h.allGood : h.needsAttention(problems.length)}</span>
        <span className="text-sm text-text-muted">{h.updatedHint}</span>
      </div>

      <LedgerSection id="health-program" title={h.program}>
        <Figures>
          <Stat label={h.version} value={m.build.version || h.devBuild} hint={[m.build.commit, m.build.platform, m.build.go].filter(Boolean).join(" · ")} />
          <Stat label={h.uptime} value={formatUptime(m.build.uptime_sec)} hint={formatDateTime(m.build.started_at)} />
          <Stat label={h.memory} value={formatBytes(m.runtime.heap_bytes)} hint={`${h.goroutines}: ${m.runtime.goroutines}`} />
        </Figures>
      </LedgerSection>

      <LedgerSection id="health-db" title={h.database}>
        <div className="divide-y divide-border">
          <StateRow
            label={h.integrity}
            tone={m.integrity.ok ? "ok" : "error"}
            state={m.integrity.ok ? h.integrityOk : h.integrityBad}
            detail={`${m.integrity.ok ? "" : `${m.integrity.verdict} · `}${h.checkedAt} ${formatDateTime(m.integrity.checked_at)}`}
          />
          <div className="px-1 py-2">
            <Button type="button" variant="outline" size="sm" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
              {recheck.isPending ? h.rechecking : h.recheck}
            </Button>
          </div>
          <StateRow
            label={h.disk}
            tone={diskTone(m)}
            state={m.disk.known ? h.diskFree(formatBytes(m.disk.free_bytes), formatBytes(m.disk.total_bytes)) : h.diskUnknown}
          />
        </div>
        <Figures>
          <Stat label={h.fileSize} value={formatBytes(m.db.file_bytes)} hint={m.db.journal_mode} />
          <Stat label={h.walSize} value={formatBytes(m.db.wal_bytes)} />
          <Stat label={h.freePages} value={m.db.freelist_count} hint={`${m.db.page_count} × ${m.db.page_size} Б`} />
        </Figures>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 px-1 py-4 text-sm sm:grid-cols-4" aria-label={h.rows}>
          {Object.entries(m.db.tables).map(([table, n]) => (
            <div key={table} className="min-w-0">
              <dt className="truncate text-xs text-text-muted">{h.tables[table] ?? table}</dt>
              <dd className="figure text-text-main">{n}</dd>
            </div>
          ))}
        </dl>
      </LedgerSection>

      <LedgerSection id="health-backups" title={h.backups}>
        <div className="divide-y divide-border">
          <StateRow
            label={h.backupJob}
            tone={backupTone(m)}
            state={backupState}
            detail={m.backups.last_error || (m.backups.last_run_at ? `${h.backupLastRun}: ${formatDateTime(m.backups.last_run_at)}` : undefined)}
          />
          <StateRow
            label={h.backupNewest}
            tone="idle"
            state={m.backups.last_copy_at ? formatDateTime(m.backups.last_copy_at) : uk.hub.noBackups}
            detail={h.backupCount(m.backups.count, formatBytes(m.backups.total_bytes))}
          />
        </div>
        <p className="px-1 py-2 text-xs text-text-muted">{h.backupNewestHint}</p>
      </LedgerSection>

      <LedgerSection id="health-jobs" title={h.jobs}>
        <div className="divide-y divide-border">
          {m.jobs.map((j) => (
            <StateRow
              key={j.name}
              label={j.label}
              tone={jobTone(j)}
              state={j.error ? j.error : j.stale ? h.jobStale : j.last_run ? formatDateTime(j.last_run) : h.jobNever}
              detail={j.runs > 0 ? h.jobRuns(j.runs, j.fails) : undefined}
            />
          ))}
        </div>
      </LedgerSection>

      <LedgerSection id="health-access" title={h.access}>
        <div className="divide-y divide-border">
          {tunnel && <StateRow label={h.tunnel} tone={tunnelTone} state={uk.system.states[tunnel.state] ?? tunnel.state} detail={tunnel.public_url || undefined} />}
          {upd && (
            <StateRow
              label={h.update}
              tone={upd.state === "error" ? "error" : upd.available ? "busy" : "ok"}
              state={upd.available ? h.updateAvailable(upd.latest) : h.updateCurrent}
              detail={upd.current || h.devBuild}
            />
          )}
          <StateRow label={h.sessions} tone="idle" state={h.sessionsValue(m.sessions.live, m.sessions.users)} />
          <StateRow
            label={h.push}
            tone={m.push.configured ? "ok" : "idle"}
            state={m.push.configured ? h.pushValue(m.push.subscriptions, m.push.backlog) : h.pushOff}
          />
        </div>
      </LedgerSection>

      <LedgerSection id="health-http" title={h.requests}>
        <Figures>
          <Stat label={h.requestsTotal} value={m.http.requests} hint={formatUptime(m.http.since_sec)} />
          <Stat label={h.clientErrors} value={m.http.client_errors} hint={h.clientErrorsHint} />
          <Stat label={h.serverErrors} value={m.http.server_errors} hint={m.http.server_errors > 0 ? undefined : h.noServerErrors} />
        </Figures>
        {m.http.last_server_error && (
          <StateRow
            label={h.lastServerError}
            tone={httpTone(m)}
            state={`${m.http.last_server_error.status} ${m.http.last_server_error.method} ${m.http.last_server_error.path}`}
            detail={formatDateTime(m.http.last_server_error.at)}
          />
        )}
        {m.http.last_server_error?.message && <p className="break-words px-1 pb-2 text-sm text-text-main">{m.http.last_server_error.message}</p>}
      </LedgerSection>

      <LedgerSection id="health-log" title={h.log} description={h.logHint}>
        <div className="flex flex-wrap items-center gap-2 px-1 py-3">
          {(["", "error", "warning"] as const).map((lvl) => (
            <Button key={lvl || "all"} type="button" size="sm" variant={logLevel === lvl ? "primary" : "outline"} aria-pressed={logLevel === lvl} onClick={() => setLogLevel(lvl)}>
              {lvl === "" ? h.logAll : lvl === "error" ? h.logErrors : h.logWarnings}
            </Button>
          ))}
          {logs && <span className="text-sm text-text-muted">{h.logCounts(logs.errors_24h, logs.warnings_24h)}</span>}
        </div>
        {!logs || logs.entries.length === 0 ? (
          <p className="px-1 py-3 text-sm text-text-muted">{h.logEmpty}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {logs.entries.map((e, i) => (
              <li key={`${e.at}-${i}`} className="space-y-0.5 px-1 py-2.5 text-sm">
                <p className="flex flex-wrap items-center gap-x-3">
                  <span className="figure text-xs text-text-muted">{formatDateTime(e.at)}</span>
                  <span className="flex items-center gap-1.5 font-medium text-text-main">
                    <StateDot tone={e.level === "error" ? "error" : "busy"} />
                    {e.level === "error" ? h.levelError : h.levelWarning}
                  </span>
                  {e.count > 1 && <span className="figure text-xs text-text-muted">{h.times(e.count)}</span>}
                </p>
                <p className="break-words text-text-main">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
        {logs && <p className="px-1 py-2 text-xs text-text-muted">{logs.persisted ? h.logPersisted : h.logMemoryOnly}</p>}
      </LedgerSection>
    </div>
  );
}
