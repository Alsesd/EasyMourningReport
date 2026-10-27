import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api/client";
import type { AdminReportListItemDTO } from "@/shared/api/types";
import { uk, formatCurrency, formatPeriodReadable, shiftPeriod } from "@/shared/i18n/uk";
import { Card, CardHeader, CardTitle, CardContent } from "@/shared/components/ui/Card";
import { Button } from "@/shared/components/ui/Button";
import { StatusPill } from "@/shared/components/ui/StatusPill";
import { ChevronLeft, ChevronRight, ChevronRight as ArrowIcon, BarChart3, AlertCircle } from "lucide-react";

export default function AdminReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const period = searchParams.get("period") || new Date().toISOString().slice(0, 7);

  const { data: reports, isLoading, error, refetch } = useQuery({
    queryKey: ["adminReports", period],
    queryFn: () =>
      api.get<AdminReportListItemDTO[]>("/api/v1/admin/reports", {
        params: { period },
      }),
  });

  const handlePeriodChange = (newPeriod: string) => {
    if (!newPeriod || !/^\d{4}-(0[1-9]|1[0-2])$/.test(newPeriod)) return;
    const next = new URLSearchParams(searchParams);
    next.set("period", newPeriod);
    setSearchParams(next);
  };

  const previousPeriod = shiftPeriod(period, -1);
  const nextPeriod = shiftPeriod(period, 1);

  const reportItems = reports || [];
  const totalSumCents = reportItems.reduce((acc, r) => acc + (r.total_cents || 0), 0);
  const submittedCount = reportItems.filter((r) => r.status === "submitted").length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.reports.title}</h1>
          <p className="text-sm text-text-muted mt-1">{formatPeriodReadable(period)}</p>
        </div>

        <Link
          to={`/admin/summary?period=${period}`}
          className="inline-flex items-center justify-center rounded-control font-medium transition-colors min-h-[44px] px-4 py-2 text-sm bg-surface border border-border text-text-main hover:bg-page shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BarChart3 className="h-4 w-4 mr-2 text-primary shrink-0" />
          Відкрити зведений звіт
        </Link>
      </div>

      {/* Month Navigation */}
      <Card>
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => handlePeriodChange(previousPeriod)}
              aria-label={uk.store.previousMonth}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <input
              type="month"
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="h-11 px-3 py-2 rounded-control border border-border bg-page text-text-main text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Місяць"
            />

            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => handlePeriodChange(nextPeriod)}
              aria-label={uk.store.nextMonth}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex items-center space-x-4 text-xs sm:text-sm text-text-muted">
            <span>
              Подано: <strong className="text-text-main tabular-nums">{submittedCount}</strong> з{" "}
              <strong className="text-text-main tabular-nums">{reportItems.length}</strong>
            </span>
            <span>·</span>
            <span>
              Разом: <strong className="text-primary tabular-nums font-mono">{formatCurrency(totalSumCents)}</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Error state */}
      {error && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 rounded-card bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between"
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm">{error instanceof Error ? error.message : "Не вдалося завантажити звіти"}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Повторити
          </Button>
        </div>
      )}

      {/* Reports List */}
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base sm:text-lg">Список звітів по магазинах</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-text-muted text-sm flex flex-col items-center justify-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Завантажую звіти…</span>
            </div>
          ) : reportItems.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">
              {uk.reports.noReports}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {reportItems.map((item) => {
                const hasReport = Boolean(item.report_id);

                const Content = (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 gap-3 sm:gap-4 hover:bg-page/40 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-text-main truncate text-base">
                          {item.store_name}
                        </span>
                        {item.store_archived && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-destructive/10 text-destructive">
                            В архіві
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 mt-1 text-xs text-text-muted">
                        <span>{item.period}</span>
                        {hasReport && (
                          <>
                            <span>·</span>
                            <span>{item.item_count} позицій</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end space-x-3 sm:space-x-4 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-border/40">
                      <StatusPill status={item.status} />

                      <span className="font-bold tabular-nums font-mono text-base text-text-main text-right">
                        {formatCurrency(item.total_cents)}
                      </span>

                      {hasReport ? (
                        <ArrowIcon className="h-5 w-5 text-text-muted transition-transform group-hover:translate-x-1" />
                      ) : (
                        <div className="w-5" />
                      )}
                    </div>
                  </div>
                );

                return hasReport ? (
                  <Link
                    key={item.store_id}
                    to={`/admin/reports/${item.report_id}`}
                    className="block group hover:bg-page/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-control"
                  >
                    {Content}
                  </Link>
                ) : (
                  <div key={item.store_id} className="opacity-70 bg-page/20">
                    {Content}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
