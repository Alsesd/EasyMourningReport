import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { SummaryDTO } from "@/api/types";
import { uk, formatCurrency, formatPeriodReadable, shiftPeriod } from "@/i18n/uk";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Building2, TrendingUp, AlertCircle } from "lucide-react";

export default function AdminSummaryPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const period = searchParams.get("period") || new Date().toISOString().slice(0, 7);
  const submittedOnly = searchParams.get("submitted_only") === "1" || searchParams.get("submitted_only") === "true";

  const { data: summary, isLoading, error, refetch } = useQuery({
    queryKey: ["adminSummary", period, submittedOnly],
    queryFn: () =>
      api.get<SummaryDTO>("/api/v1/admin/summary", {
        params: {
          period,
          submitted_only: submittedOnly,
        },
      }),
  });

  const handlePeriodChange = (newPeriod: string) => {
    if (!newPeriod || !/^\d{4}-(0[1-9]|1[0-2])$/.test(newPeriod)) return;
    const next = new URLSearchParams(searchParams);
    next.set("period", newPeriod);
    setSearchParams(next);
  };

  const handleSubmittedOnlyChange = (checked: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (checked) {
      next.set("submitted_only", "1");
    } else {
      next.delete("submitted_only");
    }
    setSearchParams(next);
  };

  const previousPeriod = shiftPeriod(period, -1);
  const nextPeriod = shiftPeriod(period, 1);

  const excelUrl = `/admin/summary.xlsx?period=${encodeURIComponent(period)}${
    submittedOnly ? "&submitted_only=1" : ""
  }`;

  const stores = summary?.stores || [];
  const rows = summary?.rows || [];
  const storeTotals = summary?.store_totals_cents || [];
  const grandTotal = summary?.grand_total_cents || 0;

  const totalQuantity = rows.reduce((acc, row) => acc + (row.quantity || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Controls Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.summary.title}</h1>
          <p className="text-sm text-text-muted mt-1">{formatPeriodReadable(period)}</p>
        </div>

        {/* Action button */}
        <div>
          <a
            href={excelUrl}
            className="inline-flex items-center justify-center rounded-control font-medium transition-colors min-h-[44px] px-4 py-2 text-sm bg-primary text-primary-fg hover:opacity-95 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full sm:w-auto"
            download
          >
            <Download className="h-4 w-4 mr-2 shrink-0" />
            {uk.summary.downloadXlsx}
          </a>
        </div>
      </div>

      {/* Filter and Period Selector Card */}
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

          <label className="flex items-center space-x-3 cursor-pointer select-none min-h-[44px]">
            <input
              type="checkbox"
              checked={submittedOnly}
              onChange={(e) => handleSubmittedOnlyChange(e.target.checked)}
              className="h-5 w-5 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm font-medium text-text-main">{uk.summary.submittedOnly}</span>
          </label>
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
            <span className="text-sm">{error instanceof Error ? error.message : "Не вдалося сформувати звіт"}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Повторити
          </Button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{uk.summary.kpiTotal}</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold tabular-nums text-text-main">
              {isLoading ? "—" : formatCurrency(grandTotal)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{uk.summary.kpiTotalStores}</span>
              <Building2 className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold tabular-nums text-text-main">
              {isLoading ? "—" : stores.length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{uk.summary.tableTotalQuantity}</span>
              <FileSpreadsheet className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold tabular-nums text-text-main">
              {isLoading ? "—" : totalQuantity}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Matrix Table */}
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base sm:text-lg flex items-center justify-between">
            <span>Зведена таблиця</span>
            <Link
              to={`/admin/reports?period=${period}`}
              className="text-xs font-normal text-primary hover:underline min-h-[44px] flex items-center"
            >
              Переглянути звіти окремо →
            </Link>
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-text-muted text-sm flex flex-col items-center justify-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>Формую зведений звіт…</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-page/50 text-text-muted text-xs uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4 min-w-[200px] sticky left-0 bg-surface sm:bg-transparent z-10">
                    {uk.summary.tableProduct}
                  </th>
                  {stores.map((store) => (
                    <th key={store.id} className="py-3 px-3 text-right whitespace-nowrap min-w-[120px]">
                      <span>{store.name}</span>
                      {store.archived && (
                        <span className="ml-1 text-[10px] text-destructive font-normal lowercase">(в архіві)</span>
                      )}
                    </th>
                  ))}
                  <th className="py-3 px-3 text-right whitespace-nowrap min-w-[90px]">
                    {uk.summary.tableTotalQuantity}
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap min-w-[120px]">
                    {uk.summary.tableTotalSum}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={stores.length + 3}
                      className="py-12 text-center text-text-muted text-sm"
                    >
                      {uk.summary.noData}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={`${row.name}-${row.price_cents}-${idx}`} className="hover:bg-page/40 transition-colors">
                      <td className="py-3 px-4 sticky left-0 bg-surface sm:bg-transparent z-10">
                        <div className="font-medium text-text-main">{row.name}</div>
                        {row.note && (
                          <div className="text-xs text-text-muted">ціна: {row.note}</div>
                        )}
                      </td>
                      {(row.cells || []).map((cell, cellIdx) => (
                        <td
                          key={cellIdx}
                          className="py-3 px-3 text-right tabular-nums text-text-main font-mono"
                        >
                          {cell > 0 ? cell : <span className="text-text-muted/40">—</span>}
                        </td>
                      ))}
                      <td className="py-3 px-3 text-right tabular-nums font-semibold text-text-main font-mono">
                        {row.quantity}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-text-main font-mono">
                        {formatCurrency(row.sum_cents)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="border-t-2 border-border bg-page/70 font-semibold text-text-main">
                  <tr>
                    <td className="py-4 px-4 sticky left-0 bg-page sm:bg-transparent z-10">
                      {uk.summary.grandTotal}
                    </td>
                    {storeTotals.map((amount, idx) => (
                      <td key={idx} className="py-4 px-3 text-right tabular-nums font-mono">
                        {formatCurrency(amount)}
                      </td>
                    ))}
                    <td className="py-4 px-3 text-right tabular-nums font-mono text-text-muted">
                      {totalQuantity}
                    </td>
                    <td className="py-4 px-4 text-right tabular-nums font-mono text-primary text-base">
                      {formatCurrency(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
