/** Backups and database health: schedule, integrity, recent copies and an on-demand download. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { systemApi } from "@/platform/system/api";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import { buttonClass } from "@/ui/Button";
import { LedgerSection } from "@/ui/LedgerSection";
import { StateDot } from "@/ui/StateDot";
import { Download } from "lucide-react";

const b = uk.system.backup;
const REFRESH_MS = 15000;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
  return `${(bytes / 1024 ** 4).toFixed(1)} ТБ`;
}

export default function BackupSection() {
  const queryClient = useQueryClient();
  // Only this section refreshes: new copies and the health figures show up by themselves, without a page reload.
  // Polling pauses while the tab is hidden (react-query default) and resumes with a fresh read.
  const { data: health } = useQuery({ queryKey: ["systemHealth"], queryFn: () => systemApi.health(), refetchInterval: REFRESH_MS });
  const { data: backups = [] } = useQuery({ queryKey: ["backups"], queryFn: () => systemApi.backups(8), refetchInterval: REFRESH_MS });
  // A download takes a fresh "snapshot" copy on the server; show it once the file has been made.
  const refreshSoon = () =>
    window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
      void queryClient.invalidateQueries({ queryKey: ["systemHealth"] });
    }, 3000);

  return (
    <div className="grid gap-10 xl:grid-cols-2">
      <LedgerSection
        id="backup-database"
        title={uk.hub.database}
        actions={
          <a href={systemApi.backupDownloadUrl} download onClick={refreshSoon} className={buttonClass("primary", "sm")}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {b.downloadButton}
          </a>
        }
      >
        {health ? (
          <>
            <dl className="divide-y divide-border text-sm">
              <div className="flex items-center justify-between gap-3 px-1 py-3">
                <dt className="text-text-muted">{b.integrity}</dt>
                <dd className="flex items-center gap-2 text-right font-medium text-text-main">
                  <StateDot tone={health.database_ok ? "ok" : "error"} />
                  {health.database_ok ? uk.hub.databaseOk : `${uk.hub.databaseProblem}: ${health.integrity}`}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-1 py-3">
                <dt className="text-text-muted">{b.size}</dt>
                <dd className="figure text-text-main">{formatBytes(health.database_size_bytes)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-1 py-3">
                <dt className="text-text-muted">{uk.hub.lastBackup}</dt>
                <dd className="figure text-right text-text-main">{health.last_backup_at ? formatDateTime(health.last_backup_at) : uk.hub.noBackups}</dd>
              </div>
            </dl>
            <p className="border-t border-border px-1 pt-3 text-xs text-text-muted">
              {b.schedule(health.backup_every_min)} {b.journal(health.journal_mode)}
            </p>
          </>
        ) : (
          <p className="py-6 text-sm text-text-muted">{uk.common.loading}</p>
        )}
      </LedgerSection>

      <LedgerSection id="backup-recent" title={b.recent}>
        <ul className="divide-y divide-border text-sm">
          {backups.length === 0 ? (
            <li className="px-1 py-6 text-text-muted">{uk.hub.noBackups}</li>
          ) : (
            backups.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 px-1 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-text-main">
                    {item.name}
                    {item.name.endsWith("-snapshot.db") && <span className="ml-2 text-xs text-text-muted">· {b.snapshot}</span>}
                  </span>
                  <span className="figure block text-xs text-text-muted">{formatDateTime(item.created_at)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="figure text-xs text-text-muted">{formatBytes(item.size_bytes)}</span>
                  <a
                    href={systemApi.backupFileUrl(item.name)}
                    download
                    aria-label={b.downloadItem(item.name)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md text-text-muted hover:bg-primary/10 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                  </a>
                </span>
              </li>
            ))
          )}
        </ul>
      </LedgerSection>
    </div>
  );
}
