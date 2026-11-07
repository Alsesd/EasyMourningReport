import { describe, it, expect } from "vitest";
import type { SystemMetricsDTO } from "@/platform/api/types";
import { formatBytes } from "./BackupSection";
import { backupTone, diskTone, formatUptime, httpTone, issues, jobTone } from "./healthStatus";

const metrics = (over: Partial<SystemMetricsDTO> = {}): SystemMetricsDTO => ({
  build: { version: "Soup.V1.5", commit: "abcd1234", built_at: "", go: "go1.25", platform: "linux/amd64", started_at: "2026-11-07T08:00:00Z", uptime_sec: 3600 },
  runtime: { goroutines: 20, heap_bytes: 1 << 20, sys_bytes: 2 << 20, gc_runs: 3 },
  db: { file_bytes: 1 << 20, wal_bytes: 0, page_size: 4096, page_count: 256, freelist_count: 0, journal_mode: "wal", tables: { users: 4 } },
  integrity: { verdict: "ok", ok: true, checked_at: "2026-11-07T08:00:00Z" },
  disk: { known: true, free_bytes: 50 * 1024 ** 3, total_bytes: 100 * 1024 ** 3 },
  backups: { count: 5, every_min: 60, last_copy_at: null, last_run_at: "2026-11-07T08:00:00Z", last_error: "", run_overdue: false, configured: true, total_bytes: 1, snapshots: 0, newest_bytes: 1 },
  jobs: [{ name: "scheduler", label: "Планувальник", last_run: "2026-11-07T08:00:00Z", error: "", runs: 10, fails: 0, stale: false }],
  push: { configured: false, subscriptions: 0, backlog: 0 },
  sessions: { live: 2, users: 2 },
  http: { ok: 100, client_errors: 5, server_errors: 0, requests: 105, since_sec: 3600, server_error_pct: 0, last_server_error: null },
  ...over,
});

describe("health status", () => {
  it("is all good when nothing is wrong, and 4xx never count as a problem", () => {
    expect(issues(metrics())).toEqual([]);
    expect(httpTone(metrics())).toBe("ok");
  });

  it("flags a failed integrity check", () => {
    const m = metrics({ integrity: { verdict: "row 3 missing", ok: false, checked_at: "" } });
    expect(issues(m)).toContain("integrity");
  });

  it("turns the backup red when the job did not run in time or failed, not when the newest file is old", () => {
    const late = metrics();
    late.backups.run_overdue = true;
    expect(backupTone(late)).toBe("error");
    expect(issues(late)).toContain("backups");
    const quiet = metrics();
    quiet.backups.last_copy_at = "2026-11-01T08:00:00Z"; // an old file after a quiet week is normal
    expect(backupTone(quiet)).toBe("ok");
  });

  it("flags a job that failed or is stale, and a program fault (5xx)", () => {
    const m = metrics();
    m.jobs[0].stale = true;
    m.http.server_errors = 2;
    m.http.last_server_error = { at: new Date().toISOString(), method: "GET", path: "/api/v1/x", status: 500 };
    expect(jobTone(m.jobs[0])).toBe("error");
    expect(issues(m)).toEqual(expect.arrayContaining(["jobs", "http"]));
  });

  it("forgets a program fault after a day, but keeps counting it", () => {
    const m = metrics();
    m.http.server_errors = 1;
    m.http.last_server_error = { at: new Date(Date.now() - 2 * 86400_000).toISOString(), method: "GET", path: "/api/v1/x", status: 500 };
    expect(issues(m)).toEqual([]);
    expect(httpTone(m)).toBe("ok");
  });

  it("warns about low disk space and a large WAL", () => {
    const low = metrics();
    low.disk.free_bytes = 300 * 1024 ** 2;
    expect(diskTone(low)).toBe("error");
    const warn = metrics();
    warn.disk.free_bytes = 1024 ** 3;
    expect(diskTone(warn)).toBe("busy");
    const wal = metrics();
    wal.db.wal_bytes = 100 * 1024 ** 2;
    expect(issues(wal)).toContain("wal");
    const unknown = metrics();
    unknown.disk.known = false;
    expect(issues(unknown)).toEqual([]);
  });

  it("formats the uptime", () => {
    expect([90, 3700, 90000].map(formatUptime)).toEqual(["1 хв", "1 год 1 хв", "1 д 1 год"]);
  });

  it("writes big sizes in gigabytes", () => {
    expect([512, 2048, 5 * 1024 ** 2, 15 * 1024 ** 3, 3 * 1024 ** 4].map(formatBytes)).toEqual(["512 Б", "2.0 КБ", "5.0 МБ", "15.0 ГБ", "3.0 ТБ"]);
  });
});
