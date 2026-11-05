/** Backups and database health: schedule, integrity, recent copies and an on-demand download. */

import { useQuery } from "@tanstack/react-query";
import { systemApi } from "@/platform/system/api";
import { formatDateTime, ukPlatform as uk } from "@/platform/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/Card";
import { StateDot } from "@/ui/StateDot";
import { Database, Download } from "lucide-react";

const b = uk.system.backup;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function BackupSection() {
  const { data: health } = useQuery({ queryKey: ["systemHealth"], queryFn: () => systemApi.health() });
  const { data: backups = [] } = useQuery({ queryKey: ["backups"], queryFn: () => systemApi.backups(8) });

  return (
    <div className="grid gap-6 lg:grid-cols-2 animate-fade-in">
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" aria-hidden="true" />
            {uk.hub.database}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-5 space-y-4 text-sm">
          {health ? (
            <dl className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">{uk.hub.database}</dt>
                <dd className="flex items-center gap-2 font-medium text-text-main">
                  <StateDot tone={health.database_ok ? "ok" : "error"} />
                  {health.database_ok ? uk.hub.databaseOk : `${uk.hub.databaseProblem}: ${health.integrity}`}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">{b.size}</dt>
                <dd className="font-mono tabular-nums text-text-main">{formatBytes(health.database_size_bytes)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-muted">{uk.hub.lastBackup}</dt>
                <dd className="text-text-main">{health.last_backup_at ? formatDateTime(health.last_backup_at) : uk.hub.noBackups}</dd>
              </div>
              <p className="text-xs text-text-muted">{b.journal(health.journal_mode)}</p>
              <p className="text-xs text-text-muted">{b.schedule(health.backup_every_min)}</p>
            </dl>
          ) : (
            <p className="text-text-muted">{uk.common.loading}</p>
          )}
          <a
            href={systemApi.backupDownloadUrl}
            download
            className="inline-flex items-center justify-center rounded-control font-medium transition-colors min-h-[44px] px-5 py-2.5 text-sm bg-primary text-primary-fg hover:opacity-95 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full sm:w-auto"
          >
            <Download className="h-4 w-4 mr-2" aria-hidden="true" />
            {b.downloadButton}
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base">{b.recent}</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border text-sm">
          {backups.length === 0 ? (
            <li className="p-4 text-text-muted">{uk.hub.noBackups}</li>
          ) : (
            backups.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs text-text-main">{item.name}</span>
                  <span className="block text-xs text-text-muted">{formatDateTime(item.created_at)}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-text-muted shrink-0">{formatBytes(item.size_bytes)}</span>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}
