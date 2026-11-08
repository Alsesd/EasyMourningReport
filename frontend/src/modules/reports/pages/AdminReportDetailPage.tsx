import { useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { reportsApi } from "@/modules/reports/api";
import { uk, formatCurrency, formatPeriodReadable, formatDayReadable } from "@/modules/reports/i18n";
import { UNDATED } from "@/modules/reports/api";
import { DayStrip, MONTH_VIEW } from "@/modules/reports/components/DayStrip";
import { LedgerSection } from "@/ui/LedgerSection";
import { Notice } from "@/ui/Notice";
import { PageHeader } from "@/ui/PageHeader";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/modules/reports/components/StatusPill";
import { Signature } from "@/modules/reports/components/Signature";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/ui/Dialog";
import { ChevronLeft, Lock, Unlock } from "lucide-react";

export default function AdminReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  // ?day=YYYY-MM-DD (or "undated") opens one day of the month; without it the month (the sum of its days).
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("day") || MONTH_VIEW;
  const isDayView = view !== MONTH_VIEW;
  const selectView = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === MONTH_VIEW) params.delete("day");
    else params.set("day", next);
    setSearchParams(params, { replace: true });
    setFeedbackMessage(null);
  };

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey: ["adminReportDetail", reportId],
    queryFn: () => reportsApi.reportDetail(reportId ?? ""),
    enabled: Boolean(reportId),
  });
  const daysQuery = useQuery({
    queryKey: ["adminReportDays", reportId],
    queryFn: () => reportsApi.reportDays(reportId ?? ""),
    enabled: Boolean(reportId),
  });
  const dayQuery = useQuery({
    queryKey: ["adminReportDay", reportId, view],
    queryFn: () => reportsApi.reportDay(reportId ?? "", view),
    enabled: Boolean(reportId) && isDayView,
  });

  const toggleLockMutation = useMutation({
    mutationFn: async (targetStatus: "draft" | "submitted") => {
      if (isDayView) return reportsApi.setReportDayStatus(reportId ?? "", view, targetStatus);
      return reportsApi.setReportStatus(reportId ?? "", targetStatus);
    },
    onSuccess: (_, targetStatus) => {
      queryClient.invalidateQueries({ queryKey: ["adminReportDetail", reportId] });
      queryClient.invalidateQueries({ queryKey: ["adminReportDays", reportId] });
      queryClient.invalidateQueries({ queryKey: ["adminReportDay", reportId] });
      queryClient.invalidateQueries({ queryKey: ["adminReports"] });
      queryClient.invalidateQueries({ queryKey: ["adminDailyReports"] });
      setFeedbackMessage({
        text: isDayView
          ? targetStatus === "submitted" ? uk.daily.dayLocked : uk.daily.dayUnlocked
          : targetStatus === "submitted" ? uk.detail.locked : uk.detail.unlocked,
        kind: "ok",
      });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      setFeedbackMessage({
        text: err.message || uk.detail.statusError,
        kind: "err",
      });
      setDialogOpen(false);
    },
  });

  const backLink = (period?: string) => (
    <Link to={period ? `/admin/reports?period=${period}` : "/admin/reports"} className="inline-flex min-h-[44px] items-center gap-1 text-text-muted transition-colors hover:text-text-main">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {period ? uk.detail.backToMonth(formatPeriodReadable(period)) : uk.detail.backToReports}
    </Link>
  );

  if (isLoading) {
    return <p className="text-sm text-text-muted">{uk.detail.loading}</p>;
  }

  if (error || !report) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {backLink()}
        <div role="alert" className="ledger flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-destructive">
          <span>{error instanceof Error ? error.message : uk.detail.loadError}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            {uk.month.retry}
          </Button>
        </div>
      </div>
    );
  }

  const days = daysQuery.data;
  const day = isDayView ? dayQuery.data : undefined;
  // What the page shows: the month, or the selected day (same lines shape).
  const shown = isDayView ? day : report;
  const status = shown?.status ?? "new";
  const isSubmitted = status === "submitted";
  const targetStatus = isSubmitted ? "draft" : "submitted";
  const canToggle = isDayView ? Boolean(day && day.status !== "new") : true;
  const dayTitle = view === UNDATED ? uk.daily.undated : formatDayReadable(view);
  const lockLabel = isDayView ? (isSubmitted ? uk.daily.unlockDay : uk.daily.lockDay) : isSubmitted ? uk.reports.unlockReport : uk.reports.lockReport;
  const daysSent = days ? days.days.filter((d) => d.status === "submitted").length : 0;

  const displayLines = (shown?.rows || []).flatMap((row) =>
    (row.inputs || [])
      .filter((input) => (input.quantity || 0) > 0 || (input.quantity_calc || 0) > 0 || row.repriced)
      .map((input) => ({ name: row.name, repriced: row.repriced, ...input }))
  );

  const getPriceLabel = (label: string) => {
    switch (label) {
      case "old":
        return uk.store.priceOldTag;
      case "new":
        return uk.store.priceNewTag;
      case "saved":
        return uk.store.priceSavedTag;
      default:
        return "";
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        className="pb-0"
        crumb={backLink(report.period)}
        title={report.store_name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{formatPeriodReadable(report.period)}</span>
            <StatusPill status={report.status} />
            {days?.daily && <span>{uk.daily.daysSubmittedOf(daysSent, days.days.length)}</span>}
            {!isDayView && <Signature status={report.status} signed={report} />}
            {report.store_archived && <span>{uk.month.archived}</span>}
          </span>
        }
        actions={
          canToggle && (
            <Button variant={isSubmitted ? "outline" : "primary"} onClick={() => setDialogOpen(true)} disabled={toggleLockMutation.isPending}>
              {isSubmitted ? <Unlock className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
              {lockLabel}
            </Button>
          )
        }
      />

      {days?.daily && <DayStrip days={days} value={view} onChange={selectView} onlyFilled />}

      {isDayView && (
        <div className="space-y-1">
          <h2 className="text-xl leading-tight">{dayTitle}</h2>
          {day && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              <StatusPill status={day.status === "new" ? "none" : day.status} customLabel={day.status === "new" ? uk.daily.noDayReport : undefined} />
              <Signature status={day.status} signed={day} />
            </div>
          )}
        </div>
      )}

      <Notice message={feedbackMessage} onDismiss={() => setFeedbackMessage(null)} dismissLabel={uk.common.close} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isDayView
                ? isSubmitted ? uk.daily.unlockDayTitle : uk.daily.lockDayTitle
                : isSubmitted ? uk.reports.unlockConfirmTitle : uk.reports.lockConfirmTitle}
            </DialogTitle>
            <DialogDescription>
              {isDayView
                ? isSubmitted ? uk.daily.unlockDayMessage : uk.daily.lockDayMessage
                : isSubmitted ? uk.reports.unlockConfirmMessage : days?.daily ? uk.daily.lockMonthDailyMessage : uk.reports.lockConfirmMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {uk.store.cancelButton}
            </Button>
            <Button onClick={() => toggleLockMutation.mutate(targetStatus)} isLoading={toggleLockMutation.isPending}>
              {lockLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LedgerSection id="lines" title={isDayView ? uk.daily.dayProductsTitle : uk.detail.linesTitle}>
        {isDayView && dayQuery.isLoading ? (
          <p className="py-6 text-sm text-text-muted">{uk.detail.loading}</p>
        ) : isDayView && dayQuery.error ? (
          <p role="alert" className="py-6 text-sm text-destructive">{dayQuery.error instanceof Error ? dayQuery.error.message : uk.detail.loadError}</p>
        ) : displayLines.length === 0 ? (
          <p className="py-6 text-sm text-text-muted">{uk.detail.noLines}</p>
        ) : (
          <ul className="divide-y divide-border">
            {displayLines.map((line, idx) => {
              const labelText = getPriceLabel(line.label || "");
              return (
                <li key={`${line.name}-${line.price_cents}-${idx}`} className="flex items-center justify-between gap-4 px-1 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-main">
                      {line.name}
                      {labelText && <span className="ml-2 text-xs font-normal text-attention">{labelText}</span>}
                    </p>
                    <p className="figure text-sm text-text-muted">
                      {line.quantity} × {formatCurrency(line.price_cents)}
                      {shown?.calculation_enabled && (
                        <span className="font-sans">
                          , {uk.store.calculationShort}: <span className="figure text-text-main">{line.quantity_calc || 0}</span>
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="figure shrink-0 text-right text-[1.0625rem] text-text-main">{formatCurrency(line.sum_cents)}</span>
                </li>
              );
            })}
          </ul>
        )}

        {shown?.inactive_rows && shown.inactive_rows.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="px-1 pb-1 text-sm font-medium text-text-muted">{uk.store.inactiveSectionTitle}</p>
            <ul className="divide-y divide-border border-l-2 border-border pl-3">
              {shown.inactive_rows.map((row, idx) => (
                <li key={idx} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block text-text-main">{row.name}</span>
                    <span className="block text-xs text-text-muted">
                      {row.archived ? uk.detail.archivedProduct : uk.detail.inactiveProduct}, <span className="figure">{row.lines}</span>
                    </span>
                  </span>
                  <span className="figure text-text-main">{formatCurrency(row.sum_cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="double-rule mt-1 flex items-baseline justify-between gap-4 border-t border-ink px-1 py-3">
          <span className="font-medium text-text-main">{isDayView ? uk.daily.dayTotal : uk.detail.total}</span>
          <span className="figure text-xl font-semibold text-text-main">{formatCurrency(shown?.total_cents ?? 0)}</span>
        </div>
      </LedgerSection>
    </div>
  );
}
