/** What the «Стан програми» page flags, decided in one place (and tested) so the summary and the rows agree. */

import type { SystemMetricsDTO } from "@/platform/api/types";
import type { StateTone } from "@/ui/Figures";

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface HealthRow {
  key: string;
  tone: StateTone;
}

/** Tone of the free disk space: red below 500 МБ, amber below 2 ГБ. Unknown space is neutral. */
export function diskTone(m: SystemMetricsDTO): StateTone {
  if (!m.disk.known) return "idle";
  if (m.disk.free_bytes < 500 * MB) return "error";
  if (m.disk.free_bytes < 2 * GB) return "busy";
  return "ok";
}

/** The backup job is red when it failed or has not run for twice its interval; having no copy yet is neutral. */
export function backupTone(m: SystemMetricsDTO): StateTone {
  if (!m.backups.configured) return "idle";
  if (m.backups.run_overdue) return "error";
  return m.backups.count === 0 ? "idle" : "ok";
}

export function jobTone(j: SystemMetricsDTO["jobs"][number]): StateTone {
  if (j.error || j.stale) return "error";
  return j.last_run ? "ok" : "idle";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A program fault (5xx) counts as a problem for a day after it happened; the totals stay as information.
 * 4xx are refusals (an expired sign-in, a missing page) and never count. */
export function recentServerError(m: SystemMetricsDTO, now: number = Date.now()): boolean {
  const last = m.http.last_server_error;
  return last !== null && now - new Date(last.at).getTime() < DAY_MS;
}

export function httpTone(m: SystemMetricsDTO, now: number = Date.now()): StateTone {
  return recentServerError(m, now) ? "busy" : "ok";
}

/** Rows that need a person, by name; the page shows how many. */
export function issues(m: SystemMetricsDTO, now: number = Date.now()): string[] {
  const out: string[] = [];
  if (!m.integrity.ok) out.push("integrity");
  if (backupTone(m) === "error") out.push("backups");
  if (m.jobs.some((j) => jobTone(j) === "error")) out.push("jobs");
  if (diskTone(m) !== "ok" && diskTone(m) !== "idle") out.push("disk");
  if (recentServerError(m, now)) out.push("http");
  if (m.db.wal_bytes > 64 * MB) out.push("wal");
  return out;
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} д ${h} год`;
  if (h > 0) return `${h} год ${m} хв`;
  return `${m} хв`;
}
