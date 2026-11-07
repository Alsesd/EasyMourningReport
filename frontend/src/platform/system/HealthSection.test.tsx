import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HealthSection from "./HealthSection";
import { systemApi } from "@/platform/system/api";
import type { SystemMetricsDTO } from "@/platform/api/types";

const base: SystemMetricsDTO = {
  build: { version: "", commit: "", built_at: "", go: "go1.25", platform: "linux/amd64", started_at: "2026-11-07T08:00:00Z", uptime_sec: 120 },
  runtime: { goroutines: 12, heap_bytes: 2 << 20, sys_bytes: 4 << 20, gc_runs: 1 },
  db: { file_bytes: 1 << 20, wal_bytes: 0, page_size: 4096, page_count: 256, freelist_count: 0, journal_mode: "wal", tables: { users: 4 } },
  integrity: { verdict: "ok", ok: true, checked_at: "2026-11-07T08:00:00Z" },
  disk: { known: false, free_bytes: 0, total_bytes: 0 },
  backups: { count: 2, every_min: 60, last_copy_at: null, last_run_at: null, last_error: "", run_overdue: false, configured: true, total_bytes: 10, snapshots: 0, newest_bytes: 5 },
  jobs: [{ name: "push", label: "Push-сповіщення — не налаштовано", last_run: null, error: "", runs: 0, fails: 0, stale: false }],
  push: { configured: false, subscriptions: 0, backlog: 0 },
  sessions: { live: 1, users: 1 },
  http: { ok: 10, client_errors: 2, server_errors: 0, requests: 12, since_sec: 120, server_error_pct: 0, last_server_error: null },
};

function renderPage(m: SystemMetricsDTO) {
  vi.spyOn(systemApi, "metrics").mockResolvedValue(m);
  vi.spyOn(systemApi, "tunnel").mockResolvedValue({ state: "idle" } as never);
  vi.spyOn(systemApi, "update").mockResolvedValue({ state: "idle", available: false, current: "", latest: "" } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HealthSection />
    </QueryClientProvider>,
  );
}

describe("HealthSection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says everything is fine for a healthy program", async () => {
    renderPage(base);
    expect(await screen.findByText("Усе гаразд")).toBeDefined();
    expect(screen.getByText("Запити з моменту запуску")).toBeDefined();
  });

  it("flags a failed integrity check and lets the administrator re-run it", async () => {
    const recheck = vi.spyOn(systemApi, "recheckIntegrity").mockResolvedValue({ verdict: "ok", ok: true, checked_at: "" });
    renderPage({ ...base, integrity: { verdict: "page 7 corrupt", ok: false, checked_at: "2026-11-07T08:00:00Z" } });
    expect(await screen.findByText("Потребує уваги: 1")).toBeDefined();
    expect(screen.getByText("Перевірка не пройдена")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Перевірити зараз" }));
    await waitFor(() => expect(recheck).toHaveBeenCalled());
  });

  it("flags a backup job that has not run in time", async () => {
    renderPage({ ...base, backups: { ...base.backups, run_overdue: true, last_run_at: "2026-11-05T08:00:00Z" } });
    expect(await screen.findByText("Потребує уваги: 1")).toBeDefined();
    expect(screen.getByText("Давно не запускалась")).toBeDefined();
  });
});
