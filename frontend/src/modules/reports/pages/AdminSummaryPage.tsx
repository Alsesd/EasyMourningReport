import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi } from "@/modules/reports/api";
import { uk, formatCurrency, formatPeriodReadable, shiftPeriod } from "@/modules/reports/i18n";
import { Card, CardHeader, CardTitle, CardContent } from "@/ui/Card";
import { Button } from "@/ui/Button";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  TrendingUp,
  AlertCircle,
  Table as TableIcon,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/ui/utils";

export default function AdminSummaryPage() {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;
  const storedMode = typeof window !== "undefined" ? (localStorage.getItem("admin.summary.viewMode") as "table" | "cards" | null) : null;
  const [viewMode, setViewMode] = useState<"table" | "cards">(storedMode || (isMobile ? "cards" : "table"));

  const handleSetViewMode = (mode: "table" | "cards") => {
    setViewMode(mode);
    try {
      localStorage.setItem("admin.summary.viewMode", mode);
    } catch {
      // Ignore storage errors (e.g. private browsing mode)
    }
  };

  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get("period") || new Date().toISOString().slice(0, 7);
  const submittedOnly = searchParams.get("submitted_only") === "1" || searchParams.get("submitted_only") === "true";

  const { data: summary, isLoading, error, refetch } = useQuery({
    queryKey: ["adminSummary", period, submittedOnly],
    queryFn: () => reportsApi.summary({ period, submitted_only: submittedOnly }),
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
    <div className="space-y-6 animate-fade-in">
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
            className="inline-flex items-center justify-center rounded-control font-medium transition-all hover:scale-[1.02] active:scale-[0.98] min-h-[44px] px-4 py-2 text-sm bg-primary text-primary-fg hover:opacity-95 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full sm:w-auto"
            download
          >
            <Download className="h-4 w-4 mr-2 shrink-0" />
            {uk.summary.downloadXlsx}
          </a>
        </div>
      </div>

      {/* Filter and Period Selector Card */}
      <Card className="transition-all hover:shadow-xs">
        <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 transition-transform active:scale-95"
              onClick={() => handlePeriodChange(previousPeriod)}
              aria-label={uk.store.previousMonth}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <input
              type="month"
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="h-11 px-3 py-2 rounded-control border border-border bg-page text-text-main text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
              aria-label="Місяць"
            />

            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 transition-transform active:scale-95"
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
              className="h-5 w-5 rounded border-border text-primary focus:ring-primary transition-colors"
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
          className="p-4 rounded-card bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between animate-slide-down"
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
        <Card className="hover:-translate-y-0.5 transition-all duration-200">
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

        <Card className="hover:-translate-y-0.5 transition-all duration-200">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{uk.summary.kpiSubmittedReports}</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold tabular-nums text-text-main">
              {isLoading ? "—" : `${storeTotals.filter((t) => t > 0).length} / ${stores.length}`}
            </div>
          </CardContent>
        </Card>

        <Card className="hover:-translate-y-0.5 transition-all duration-200">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between text-text-muted">
              <span className="text-xs font-medium uppercase tracking-wider">{uk.summary.tableTotalQuantity}</span>
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold tabular-nums text-text-main">
              {isLoading ? "—" : totalQuantity}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Matrix Table / Mobile Cards */}
      <Card className="overflow-hidden shadow-xs border-border">
        <CardHeader className="p-4 sm:p-5 border-b border-border bg-surface">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base sm:text-lg flex items-center justify-between">
              <span>Зведена таблиця</span>
            </CardTitle>

            <div className="flex items-center space-x-3">
              {/* View Mode Toggle */}
              <div className="flex items-center bg-page p-1 rounded-control border border-border">
                <button
                  type="button"
                  onClick={() => handleSetViewMode("table")}
                  className={cn(
                    "flex items-center px-2.5 py-1 rounded-lg text-xs font-medium transition-all active:scale-95",
                    viewMode === "table"
                      ? "bg-surface text-primary shadow-2xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  )}
                  title={uk.summary.viewModeTable}
                >
                  <TableIcon className="h-3.5 w-3.5 mr-1" />
                  <span>{uk.summary.viewModeTable}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSetViewMode("cards")}
                  className={cn(
                    "flex items-center px-2.5 py-1 rounded-lg text-xs font-medium transition-all active:scale-95",
                    viewMode === "cards"
                      ? "bg-surface text-primary shadow-2xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  )}
                  title={uk.summary.viewModeCards}
                >
                  <LayoutGrid className="h-3.5 w-3.5 mr-1" />
                  <span>{uk.summary.viewModeCards}</span>
                </button>
              </div>

              <Link
                to={`/admin/reports?period=${period}`}
                className="text-xs font-medium text-primary hover:underline min-h-[44px] flex items-center shrink-0"
              >
                Окремі звіти →
              </Link>
            </div>
          </div>
        </CardHeader>

        {isLoading ? (
          <div className="p-12 text-center text-text-muted text-sm flex flex-col items-center justify-center space-y-3">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="font-medium">Формую зведений звіт…</span>
          </div>
        ) : viewMode === "cards" ? (
          /* Cards View: Excellent for reading on mobile */
          <div className="p-4 sm:p-5 space-y-3 bg-page/30 animate-fade-in">
            {rows.length === 0 ? (
              <div className="py-12 text-center text-text-muted text-sm">{uk.summary.noData}</div>
            ) : (
              rows.map((row, idx) => (
                <div
                  key={`${row.name}-${row.price_cents}-${idx}`}
                  className="p-4 rounded-card border border-border bg-surface hover:border-primary/50 transition-all duration-200 shadow-2xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-semibold text-text-main text-base">{row.name}</span>
                      {row.note && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-accent-soft text-primary font-medium">
                          {row.note}
                        </span>
                      )}
                    </div>
                    <span className="font-mono font-bold text-sm text-primary shrink-0 bg-page px-2 py-1 rounded-control border border-border">
                      {formatCurrency(row.price_cents)}
                    </span>
                  </div>

                  {/* Breakdown by stores */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-border/60 text-xs">
                    {stores.map((store, sIdx) => {
                      const qty = row.cells?.[sIdx] || 0;
                      return (
                        <div
                          key={store.id}
                          className={cn(
                            "flex items-center justify-between p-2 rounded-control border transition-colors",
                            qty > 0
                              ? "bg-page border-primary/20 text-text-main font-medium"
                              : "bg-page/40 border-border/40 text-text-muted/60"
                          )}
                        >
                          <span className="truncate pr-1">{store.name}</span>
                          <span className="font-mono font-bold">{qty > 0 ? qty : "—"}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/60 text-sm">
                    <span className="text-text-muted">
                      Всього: <b className="font-mono text-text-main font-bold">{row.quantity}</b> шт.
                    </span>
                    <span className="font-mono font-bold text-primary text-base">
                      = {formatCurrency(row.sum_cents)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* Table View with dedicated Price column and frozen product column */
          <div className="overflow-auto max-h-[72vh] animate-fade-in border-t border-border">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 z-20 bg-surface border-b border-border shadow-xs">
                <tr className="bg-page/80 text-text-muted text-xs uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4 min-w-[200px] sticky left-0 top-0 bg-surface z-30 border-r border-border/60 shadow-xs">
                    {uk.summary.tableProduct}
                  </th>
                  <th className="py-3 px-3 text-right whitespace-nowrap min-w-[100px] border-r border-border/40 font-semibold text-text-muted sticky top-0 bg-surface z-20">
                    {uk.summary.tablePrice}
                  </th>
                  {stores.map((store) => (
                    <th key={store.id} className="py-3 px-3 text-right whitespace-nowrap min-w-[120px] border-r border-border/20 sticky top-0 bg-surface z-20">
                      <span>{store.name}</span>
                      {store.archived && (
                        <span className="ml-1 text-[10px] text-destructive font-normal lowercase">(в архіві)</span>
                      )}
                    </th>
                  ))}
                  <th className="py-3 px-3 text-right whitespace-nowrap min-w-[90px] border-r border-border/40 font-semibold sticky top-0 bg-surface z-20">
                    {uk.summary.tableTotalQuantity}
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap min-w-[120px] font-semibold sticky top-0 bg-surface z-20">
                    {uk.summary.tableTotalSum}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={stores.length + 4}
                      className="py-12 text-center text-text-muted text-sm"
                    >
                      {uk.summary.noData}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr
                      key={`${row.name}-${row.price_cents}-${idx}`}
                      className="even:bg-page/20 hover:bg-page/50 transition-colors"
                    >
                      <td className="py-3 px-4 sticky left-0 bg-surface z-10 border-r border-border/60 shadow-xs">
                        <div className="font-medium text-text-main">{row.name}</div>
                        {row.note && (
                          <div className="text-[11px] text-text-muted">{row.note}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-text-muted font-mono border-r border-border/40 whitespace-nowrap">
                        {formatCurrency(row.price_cents)}
                      </td>
                      {(row.cells || []).map((cell, cellIdx) => (
                        <td
                          key={cellIdx}
                          className="py-3 px-3 text-right tabular-nums text-text-main font-mono border-r border-border/20"
                        >
                          {cell > 0 ? cell : <span className="text-text-muted/40">—</span>}
                        </td>
                      ))}
                      <td className="py-3 px-3 text-right tabular-nums font-semibold text-text-main font-mono border-r border-border/40">
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
                <tfoot className="sticky bottom-0 z-20 border-t-2 border-border bg-surface shadow-xs font-semibold text-text-main">
                  <tr className="bg-page/90">
                    <td className="py-4 px-4 sticky left-0 bottom-0 bg-surface z-30 border-r border-border/60 shadow-xs">
                      {uk.summary.grandTotal}
                    </td>
                    <td className="py-4 px-3 text-right tabular-nums font-mono text-text-muted border-r border-border/40">
                      —
                    </td>
                    {storeTotals.map((amount, idx) => (
                      <td key={idx} className="py-4 px-3 text-right tabular-nums font-mono border-r border-border/20">
                        {formatCurrency(amount)}
                      </td>
                    ))}
                    <td className="py-4 px-3 text-right tabular-nums font-mono text-text-muted border-r border-border/40">
                      {totalQuantity}
                    </td>
                    <td className="py-4 px-4 text-right tabular-nums font-mono text-primary text-base">
                      {formatCurrency(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
