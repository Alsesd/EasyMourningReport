/**
 * «Звіти» for one month: every store's report state (the register) and the products matrix that
 * the Excel export mirrors. Replaces the former separate summary and reports-list pages.
 */

import { Fragment } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download } from "lucide-react";
import { reportsApi } from "@/modules/reports/api";
import { uk, formatCurrency, formatPeriodReadable } from "@/modules/reports/i18n";
import { StatusPill } from "@/modules/reports/components/StatusPill";
import { signatureLines } from "@/modules/reports/components/Signature";
import type { AdminReportListItemDTO, SummaryDTO } from "@/platform/api/types";
import { buttonClass, Button } from "@/ui/Button";
import { LedgerSection } from "@/ui/LedgerSection";
import { PageHeader } from "@/ui/PageHeader";
import { PeriodPicker } from "@/ui/PeriodPicker";
import { Switch } from "@/ui/Switch";
import { cn } from "@/ui/utils";

const m = uk.month;

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ReportsMonthPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("period");
  const period = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentPeriod();
  const submittedOnly = ["1", "true"].includes(searchParams.get("submitted_only") ?? "");

  const reportsQuery = useQuery({ queryKey: ["adminReports", period], queryFn: () => reportsApi.reportList(period) });
  const summaryQuery = useQuery({
    queryKey: ["adminSummary", period, submittedOnly],
    queryFn: () => reportsApi.summary({ period, submitted_only: submittedOnly }),
  });

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next);
  };

  const reports = reportsQuery.data ?? [];
  const sent = reports.filter((r) => r.status === "submitted").length;
  const missing = reports.filter((r) => !r.report_id).length;

  return (
    <div className="mx-auto max-w-[1180px] space-y-8 lg:space-y-10">
      <PageHeader
        crumb={m.crumb}
        title={formatPeriodReadable(period)}
        meta={reportsQuery.data ? (reports.length === 0 ? m.noDivisions : `${m.submittedOf(sent, reports.length)}, ${m.notReported(missing)}`) : undefined}
        actions={
          <>
            <PeriodPicker
              value={period}
              onChange={(p) => update((n) => n.set("period", p))}
              labels={{ previous: uk.store.previousMonth, next: uk.store.nextMonth, month: uk.store.monthLabel }}
            />
            <a href={reportsApi.summaryExcelUrl(period, submittedOnly)} download className={buttonClass("primary")}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {uk.summary.downloadXlsx}
            </a>
          </>
        }
      />

      <LedgerSection id="stores" title={m.storesTitle} description={m.storesDescription}>
        <StoreRegister query={reportsQuery} reports={reports} />
      </LedgerSection>

      <LedgerSection
        id="products"
        title={m.productsTitle}
        description={m.productsDescription}
        actions={
          <Switch
            checked={submittedOnly}
            onChange={(checked) => update((n) => (checked ? n.set("submitted_only", "1") : n.delete("submitted_only")))}
            label={uk.summary.submittedOnly}
            onText={uk.summary.submittedOnly}
            offText={m.allReports}
          />
        }
      >
        <ProductsMatrix query={summaryQuery} />
      </LedgerSection>
    </div>
  );
}

function QueryState({ isLoading, error, onRetry, loading }: { isLoading: boolean; error: unknown; onRetry: () => void; loading: string }) {
  if (isLoading) return <p className="py-8 text-sm text-text-muted">{loading}</p>;
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-destructive">
      <span>{error instanceof Error ? error.message : m.loadError}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {m.retry}
      </Button>
    </div>
  );
}

function StoreRegister({
  query,
  reports,
}: {
  query: { isLoading: boolean; error: unknown; refetch: () => unknown };
  reports: AdminReportListItemDTO[];
}) {
  if (query.isLoading || query.error) {
    return <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} loading={m.loading} />;
  }
  if (reports.length === 0) return <p className="py-8 text-sm text-text-muted">{uk.reports.noReports}</p>;
  const total = reports.reduce((acc, r) => acc + (r.total_cents || 0), 0);

  return (
    <div>
      <ul className="divide-y divide-border">
        {reports.map((item) => {
          const row = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-text-main">{item.store_name}</span>
                <span className="block text-xs text-text-muted">
                  {item.report_id ? m.positions(item.item_count) : m.noReportYet}
                  {item.store_archived && `, ${m.archived}`}
                </span>
                {signatureLines(item.status, item).map((line) => (
                  <span key={line} className="block text-xs text-text-muted">
                    {line}
                  </span>
                ))}
              </span>
              <StatusPill status={item.status} className="w-32 shrink-0 max-sm:hidden" />
              <span className="figure w-32 shrink-0 text-right text-[1.0625rem] text-text-main">{formatCurrency(item.total_cents)}</span>
              <span className="w-5 shrink-0 text-text-muted" aria-hidden="true">
                {item.report_id && <ChevronRight className="h-4 w-4" />}
              </span>
            </>
          );
          const base = "flex min-h-[60px] items-center gap-4 px-3 py-2.5";
          return (
            <li key={item.store_id} className={cn(!item.report_id && "bg-attention-soft/60")}>
              {item.report_id ? (
                <Link to={`/admin/reports/${item.report_id}`} className={cn(base, "transition-colors hover:bg-surface-raised")}>
                  {row}
                </Link>
              ) : (
                <div className={base}>{row}</div>
              )}
              <StatusPill status={item.status} className="-mt-2 px-3 pb-2.5 sm:hidden" />
            </li>
          );
        })}
      </ul>
      <div className="double-rule flex items-center gap-4 border-t border-ink px-3 py-3">
        <span className="flex-1 font-medium text-text-main">{m.monthTotal}</span>
        <span className="figure text-right text-xl font-semibold text-text-main">{formatCurrency(total)}</span>
        <span className="w-5 shrink-0" />
      </div>
    </div>
  );
}

function ProductsMatrix({ query }: { query: { data?: SummaryDTO; isLoading: boolean; error: unknown; refetch: () => unknown } }) {
  if (query.isLoading || query.error || !query.data) {
    return <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} loading={m.loadingSummary} />;
  }
  const stores = query.data.stores ?? [];
  const rows = query.data.rows ?? [];
  const storeTotals = query.data.store_totals_cents ?? [];
  const grandTotal = query.data.grand_total_cents ?? 0;
  if (rows.length === 0) return <p className="py-8 text-sm text-text-muted">{uk.summary.noData}</p>;

  const withCalc = stores.some((s) => s.calculation_enabled);
  const totalQuantity = rows.reduce((acc, r) => acc + (r.quantity || 0), 0);
  const totalCalc = rows.reduce((acc, r) => acc + (r.calculation_quantity || 0), 0);
  const storeCalcTotals = stores.map((s, i) => (s.calculation_enabled ? rows.reduce((acc, r) => acc + (r.calculation_cells?.[i] || 0), 0) : 0));
  const dash = <span className="text-text-muted/50">—</span>;
  const th = "px-3 py-2.5 text-right align-bottom text-xs font-medium leading-snug text-text-muted";
  const td = "px-3 py-2.5 text-right figure text-text-main";

  return (
    <>
      {/* Wide screens: the full matrix, with the product column pinned while stores scroll. */}
      <div className="hidden max-h-[72vh] overflow-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-page">
            <tr className="border-b border-border">
              <th className="sticky left-0 z-30 min-w-[220px] bg-page px-3 py-2.5 text-left text-xs font-medium text-text-muted">{uk.summary.tableProduct}</th>
              <th className={th}>{uk.summary.tablePrice}</th>
              {stores.map((store) => (
                <Fragment key={store.id}>
                  <th className={cn(th, "min-w-[92px] max-w-[150px]")}>
                    <span title={store.name}>{store.name}</span>
                    {store.archived && <span className="block font-normal">{m.archived}</span>}
                  </th>
                  {store.calculation_enabled && <th className={cn(th, "min-w-[120px]")}>{uk.summary.tableCalculationQuantity}</th>}
                </Fragment>
              ))}
              <th className={cn(th, "border-l border-border")}>{uk.summary.tableTotalQuantity}</th>
              {withCalc && <th className={th}>{uk.summary.tableCalculationQuantityTotal}</th>}
              <th className={cn(th, "min-w-[130px]")}>{uk.summary.tableTotalSum}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, idx) => (
              <tr key={`${row.name}-${row.price_cents}-${idx}`} className="hover:bg-surface-raised/60">
                <td className="sticky left-0 z-10 bg-page px-3 py-2.5 text-left">
                  <span className="block font-medium text-text-main">{row.name}</span>
                  {row.note && <span className="block text-xs text-text-muted">{row.note}</span>}
                </td>
                <td className={cn(td, "whitespace-nowrap text-text-muted")}>{formatCurrency(row.price_cents)}</td>
                {stores.map((store, i) => (
                  <Fragment key={store.id}>
                    <td className={td}>{row.cells?.[i] || dash}</td>
                    {store.calculation_enabled && <td className={td}>{row.calculation_cells?.[i] || dash}</td>}
                  </Fragment>
                ))}
                <td className={cn(td, "border-l border-border font-semibold")}>{row.quantity}</td>
                {withCalc && <td className={cn(td, "font-semibold")}>{row.calculation_quantity}</td>}
                <td className={cn(td, "whitespace-nowrap font-semibold")}>{formatCurrency(row.sum_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 bg-page">
            <tr className="double-rule border-t border-ink">
              <td className="sticky left-0 z-30 bg-page px-3 py-3 text-left font-medium text-text-main">{uk.summary.grandTotal}</td>
              <td className={td} />
              {stores.map((store, i) => (
                <Fragment key={store.id}>
                  <td className={cn(td, "whitespace-nowrap")}>{formatCurrency(storeTotals[i] || 0)}</td>
                  {store.calculation_enabled && <td className={td}>{storeCalcTotals[i]}</td>}
                </Fragment>
              ))}
              <td className={cn(td, "border-l border-border")}>{totalQuantity}</td>
              {withCalc && <td className={td}>{totalCalc}</td>}
              <td className={cn(td, "whitespace-nowrap text-base font-semibold")}>{formatCurrency(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Narrow screens: one ruled row per product; the store breakdown opens on demand. */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((row, idx) => (
          <li key={`${row.name}-${row.price_cents}-${idx}`}>
            <details className="group">
              <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-1 py-2.5 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-text-main">{row.name}</span>
                  <span className="figure block text-xs text-text-muted">
                    {formatCurrency(row.price_cents)} × {row.quantity}
                  </span>
                </span>
                <span className="figure text-right text-text-main">{formatCurrency(row.sum_cents)}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-90" aria-hidden="true" />
              </summary>
              <dl className="mb-3 ml-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-l-2 border-border pl-3 text-sm">
                {stores.map((store, i) => (
                  <Fragment key={store.id}>
                    <dt className="truncate text-text-muted">{store.name}</dt>
                    <dd className="figure text-right text-text-main">
                      {row.cells?.[i] || 0}
                      {store.calculation_enabled && <span className="text-text-muted"> / {row.calculation_cells?.[i] || 0}</span>}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ul>
      <div className="double-rule flex items-baseline justify-between gap-3 border-t border-ink px-1 py-3 md:hidden">
        <span className="font-medium text-text-main">{uk.summary.grandTotal}</span>
        <span className="figure text-xl font-semibold text-text-main">{formatCurrency(grandTotal)}</span>
      </div>
    </>
  );
}
