/**
 * «Звіти» for one month: every store's report state (the register) and the products matrix that
 * the Excel export mirrors. Replaces the former separate summary and reports-list pages.
 */

import { SkeletonRows } from "@/ui/Skeleton";
import { Fragment } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download } from "lucide-react";
import { reportsApi } from "@/modules/reports/api";
import { uk, formatCurrency, formatPeriodReadable, formatDayReadable, formatDayShort } from "@/modules/reports/i18n";
import { StatusPill } from "@/modules/reports/components/StatusPill";
import { signatureLines } from "@/modules/reports/components/Signature";
import { MissedBadge } from "@/modules/reports/components/MissedBadge";
import type { AdminReportListItemDTO, DailyReportListItemDTO, MissedStoreDTO, SummaryDTO } from "@/platform/api/types";
import { daysBetween } from "@/modules/reports/components/DayStrip";
import { todayIso } from "@/platform/i18n";
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
  // Two tabs: «За день» (the default; ?day=YYYY-MM-DD, today or the month's last day) and «За місяць» (?tab=month,
  // the read-only sum of the days).
  const tab: "day" | "month" = searchParams.get("tab") === "month" ? "month" : "day";
  const today = todayIso();
  const monthDays = daysBetween(`${period}-01`, lastDayOf(period) < today ? lastDayOf(period) : today);
  const requestedDay = searchParams.get("day") ?? "";
  const pickedDay = monthDays.includes(requestedDay) ? requestedDay : monthDays[monthDays.length - 1] ?? "";
  const day = tab === "day" ? pickedDay : "";

  const reportsQuery = useQuery({ queryKey: ["adminReports", period], queryFn: () => reportsApi.reportList(period), enabled: !day });
  const dailyQuery = useQuery({ queryKey: ["adminDailyReports", day], queryFn: () => reportsApi.dailyReports(day), enabled: Boolean(day) });
  const missedQuery = useQuery({ queryKey: ["adminMissedDays", period], queryFn: () => reportsApi.missedDays(period) });
  const summaryQuery = useQuery({
    queryKey: ["adminSummary", period, submittedOnly, day],
    queryFn: () => reportsApi.summary({ period, submitted_only: submittedOnly, day: day || undefined }),
  });

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    change(next);
    setSearchParams(next);
  };

  const registerQuery = day ? dailyQuery : reportsQuery;
  const reports: RegisterItem[] = (day ? dailyQuery.data : reportsQuery.data) ?? [];
  const sent = reports.filter((r) => r.status === "submitted").length;
  const missing = reports.filter((r) => (day ? r.status === "none" : !r.report_id)).length;

  return (
    <div className="mx-auto max-w-[1180px] space-y-8 lg:space-y-10">
      <PageHeader
        crumb={m.crumb}
        title={day ? formatDayReadable(day) : formatPeriodReadable(period)}
        meta={registerQuery.data ? (reports.length === 0 ? m.noDivisions : `${m.submittedOf(sent, reports.length)}, ${m.notReported(missing)}`) : undefined}
        actions={
          <>
            <PeriodPicker
              value={period}
              onChange={(p) =>
                update((n) => {
                  n.set("period", p);
                  n.delete("day");
                })
              }
              labels={{ previous: uk.store.previousMonth, next: uk.store.nextMonth, month: uk.store.monthLabel }}
            />
            {tab === "day" && monthDays.length > 0 && (
              <select
                value={day}
                onChange={(e) => update((n) => n.set("day", e.target.value))}
                aria-label={uk.daily.pickDay}
                className="h-11 min-w-[11rem] rounded-control border border-border bg-surface px-3 text-[0.9375rem] font-medium text-text-main hover:border-text-muted/50"
              >
                {[...monthDays].reverse().map((d) => (
                  <option key={d} value={d}>
                    {formatDayShort(d)}
                    {d === today ? ` · ${uk.daily.today}` : ""}
                  </option>
                ))}
              </select>
            )}
            <a href={reportsApi.summaryExcelUrl(period, submittedOnly, day || undefined)} download className={buttonClass("primary")}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {uk.summary.downloadXlsx}
            </a>
          </>
        }
      />

      <ReviewTabs
        tab={tab}
        onChange={(next) =>
          update((n) => {
            if (next === "month") n.set("tab", "month");
            else n.delete("tab");
          })
        }
      />

      <div role="tabpanel" aria-labelledby={`reports-tab-${tab}`} className="space-y-8 lg:space-y-10">
      {tab === "month" && <p className="text-sm text-text-muted">{uk.daily.monthTabNote}</p>}

      {(missedQuery.data ?? []).length > 0 && (
        <LedgerSection id="missed" title={uk.daily.missedTitle} description={uk.daily.missedDescription}>
          <MissedList stores={missedQuery.data ?? []} />
        </LedgerSection>
      )}

      <LedgerSection id="stores" title={m.storesTitle} description={day ? uk.daily.dayStoresDescription : m.storesDescription}>
        <StoreRegister query={registerQuery} reports={reports} day={day} />
      </LedgerSection>

      <LedgerSection
        id="products"
        title={day ? uk.daily.dayProductsTitle : m.productsTitle}
        description={day ? uk.daily.dayProductsDescription : m.productsDescription}
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
    </div>
  );
}

/** Who did not submit which days of the month before midnight; each date opens that day of the store's report. */
function MissedList({ stores }: { stores: MissedStoreDTO[] }) {
  return (
    <ul className="divide-y divide-border">
      {stores.map((s) => (
        <li key={s.store_id} className="flex flex-wrap items-baseline gap-x-4 gap-y-2 px-1 py-3">
          <span className="min-w-[10rem] flex-1">
            <span className="block font-medium text-text-main">{s.store_name}</span>
            <span className="block text-sm text-destructive">{uk.daily.missedDays(s.days.length)}</span>
          </span>
          <span className="flex flex-wrap gap-1.5">
            {s.days.map((d) => {
              const late = s.late.includes(d);
              return (
                <Link
                  key={d}
                  to={`/admin/reports/${s.report_id}?day=${d}`}
                  aria-label={`${s.store_name}, ${formatDayReadable(d)}: ${late ? uk.daily.missedLate : uk.daily.missed}`}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-control border border-destructive/40 px-2.5 text-sm text-text-main transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="figure">{formatDayShort(d)}</span>
                  {late && <span className="text-xs text-text-muted">· {uk.daily.lateMark}</span>}
                </Link>
              );
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The review page's two tabs; arrow keys move between them (WAI-ARIA tabs). */
function ReviewTabs({ tab, onChange }: { tab: "day" | "month"; onChange: (tab: "day" | "month") => void }) {
  const tabs = [
    { id: "day" as const, label: uk.daily.tabDay },
    { id: "month" as const, label: uk.daily.tabMonth },
  ];
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? "day" : e.key === "End" ? "month" : tab === "day" ? "month" : "day";
    onChange(next);
    document.getElementById(`reports-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={uk.daily.tabsLabel} className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      {tabs.map((t) => {
        const selected = t.id === tab;
        return (
          <button
            key={t.id}
            id={`reports-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={onKey}
            className={cn(
              "-mb-px min-h-[44px] shrink-0 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-4",
              selected ? "border-primary text-text-main" : "border-transparent text-text-muted hover:text-text-main",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function QueryState({ isLoading, error, onRetry }: { isLoading: boolean; error: unknown; onRetry: () => void; loading: string }) {
  if (isLoading) return <SkeletonRows rows={4} className="mt-1" />;
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

/** A store's line in the register: the month's report, or one day of it. */
type RegisterItem = AdminReportListItemDTO | DailyReportListItemDTO;

function lastDayOf(period: string): string {
  const [y, mo] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo, 0));
  return `${period}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function StoreRegister({
  query,
  reports,
  day,
}: {
  query: { isLoading: boolean; error: unknown; refetch: () => unknown };
  reports: RegisterItem[];
  day: string;
}) {
  if (query.isLoading || query.error) {
    return <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} loading={m.loading} />;
  }
  if (reports.length === 0) return <p className="py-8 text-sm text-text-muted">{uk.reports.noReports}</p>;
  const total = reports.reduce((acc, r) => acc + (r.total_cents || 0), 0);
  // With a day, a store whose month exists but that day is empty is still not reported; its link opens the day.
  const reported = (item: RegisterItem) => (day ? item.status !== "none" : Boolean(item.report_id));
  const linkOf = (item: RegisterItem) => `/admin/reports/${item.report_id}${day ? `?day=${day}` : ""}`;

  return (
    <div>
      <ul className="divide-y divide-border">
        {reports.map((item) => {
          const row = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-text-main">{item.store_name}</span>
                <span className="block text-xs text-text-muted">
                  {reported(item) ? m.positions(item.item_count) : day ? uk.daily.noDayReport : m.noReportYet}
                  {"days_count" in item && item.days_count ? `, ${uk.daily.daysSubmittedOf(item.days_submitted ?? 0, item.days_count)}` : ""}
                  {item.store_archived && `, ${m.archived}`}
                </span>
                {signatureLines(item.status, item).map((line) => (
                  <span key={line} className="block text-xs text-text-muted">
                    {line}
                  </span>
                ))}
              </span>
              {"missed" in item && item.missed ? (
                <MissedBadge late={Boolean(item.submission)} className="w-32 shrink-0 whitespace-normal max-sm:hidden" />
              ) : (
                <StatusPill status={item.status} className="w-32 shrink-0 max-sm:hidden" />
              )}
              <span className="figure w-32 shrink-0 text-right text-[1.0625rem] text-text-main">{formatCurrency(item.total_cents)}</span>
              <span className="w-5 shrink-0 text-text-muted" aria-hidden="true">
                {item.report_id && <ChevronRight className="h-4 w-4" />}
              </span>
            </>
          );
          const base = "flex min-h-[60px] items-center gap-4 px-3 py-2.5";
          return (
            <li key={item.store_id} className={cn(!reported(item) && "bg-attention-soft/60")}>
              {item.report_id ? (
                <Link to={linkOf(item)} className={cn(base, "transition-colors hover:bg-surface-raised")}>
                  {row}
                </Link>
              ) : (
                <div className={base}>{row}</div>
              )}
              {"missed" in item && item.missed ? (
                <MissedBadge late={Boolean(item.submission)} className="-mt-2 px-3 pb-2.5 sm:hidden" />
              ) : (
                <StatusPill status={item.status} className="-mt-2 px-3 pb-2.5 sm:hidden" />
              )}
            </li>
          );
        })}
      </ul>
      <div className="double-rule flex items-center gap-4 border-t border-ink px-3 py-3">
        <span className="flex-1 font-medium text-text-main">{day ? uk.daily.dayTotal : m.monthTotal}</span>
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
