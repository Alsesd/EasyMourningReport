import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { AdminReportDetailDTO } from "@/api/types";
import { uk, formatCurrency, formatPeriodReadable } from "@/i18n/uk";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";
import { ChevronLeft, Lock, Unlock, AlertCircle, CheckCircle } from "lucide-react";

export default function AdminReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const { data: report, isLoading, error, refetch } = useQuery({
    queryKey: ["adminReportDetail", reportId],
    queryFn: () => api.get<AdminReportDetailDTO>(`/api/v1/admin/reports/${reportId}`),
    enabled: Boolean(reportId),
  });

  const toggleLockMutation = useMutation({
    mutationFn: async (targetStatus: "draft" | "submitted") => {
      return api.patch(`/api/v1/admin/reports/${reportId}`, {
        status: targetStatus,
      });
    },
    onSuccess: (_, targetStatus) => {
      queryClient.invalidateQueries({ queryKey: ["adminReportDetail", reportId] });
      queryClient.invalidateQueries({ queryKey: ["adminReports"] });
      setFeedbackMessage({
        text: targetStatus === "submitted" ? "Звіт заблоковано." : "Звіт розблоковано.",
        kind: "ok",
      });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      setFeedbackMessage({
        text: err.message || "Не вдалося змінити статус звіту.",
        kind: "err",
      });
      setDialogOpen(false);
    },
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-text-muted text-sm flex flex-col items-center justify-center space-y-2">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span>Завантажую звіт…</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-card bg-destructive/10 border border-destructive/20 text-destructive flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span className="text-sm">
              {error instanceof Error ? error.message : "Не вдалося завантажити звіт"}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Повторити
          </Button>
        </div>
        <Link
          to="/admin/reports"
          className="inline-flex items-center text-sm text-primary hover:underline min-h-[44px]"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Назад до звітів
        </Link>
      </div>
    );
  }

  const isSubmitted = report.status === "submitted";
  const targetStatus = isSubmitted ? "draft" : "submitted";

  const displayLines = (report.rows || []).flatMap((row) =>
    (row.inputs || [])
      .filter((input) => (input.quantity || 0) > 0 || row.repriced)
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

  const getPriceTagClasses = (label: string) => {
    switch (label) {
      case "old":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 border-amber-300 dark:border-amber-800";
      case "new":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800";
      case "saved":
        return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 border-blue-300 dark:border-blue-800";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div>
        <Link
          to={`/admin/reports?period=${report.period}`}
          className="inline-flex items-center text-sm text-text-muted hover:text-text-main transition-colors min-h-[44px]"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Усі звіти за {formatPeriodReadable(report.period)}
        </Link>
      </div>

      {/* Feedback banner */}
      {feedbackMessage && (
        <div
          role="status"
          aria-live="polite"
          className={`p-4 rounded-card border flex items-center justify-between text-sm ${
            feedbackMessage.kind === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/20 text-destructive"
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedbackMessage.kind === "ok" ? (
              <CheckCircle className="h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            type="button"
            className="text-text-muted hover:text-text-main p-1 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={() => setFeedbackMessage(null)}
            aria-label="Закрити"
          >
            ×
          </button>
        </div>
      )}

      {/* Report Header Card */}
      <Card>
        <CardContent className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold tracking-tight text-text-main">{report.store_name}</h1>
              {report.store_archived && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive">
                  В архіві
                </span>
              )}
              <StatusPill status={report.status} />
            </div>
            <p className="text-sm text-text-muted mt-1">{formatPeriodReadable(report.period)}</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Button
              variant={isSubmitted ? "outline" : "primary"}
              className="min-h-[44px]"
              onClick={() => setDialogOpen(true)}
              disabled={toggleLockMutation.isPending}
            >
              {isSubmitted ? (
                <>
                  <Unlock className="h-4 w-4 mr-2" />
                  {uk.reports.unlockReport}
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  {uk.reports.lockReport}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isSubmitted ? uk.reports.unlockConfirmTitle : uk.reports.lockConfirmTitle}
            </DialogTitle>
            <DialogDescription>
              {isSubmitted ? uk.reports.unlockConfirmMessage : uk.reports.lockConfirmMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {uk.store.cancelButton}
            </Button>
            <Button
              variant={isSubmitted ? "outline" : "primary"}
              onClick={() => toggleLockMutation.mutate(targetStatus)}
              disabled={toggleLockMutation.isPending}
            >
              {toggleLockMutation.isPending
                ? uk.common.loading
                : isSubmitted
                ? uk.reports.unlockReport
                : uk.reports.lockReport}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Items Card */}
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border">
          <CardTitle className="text-base sm:text-lg">Позиції звіту</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {displayLines.length === 0 ? (
            <div className="p-8 text-center text-text-muted text-sm">
              Кількостей у звіті ще немає.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {displayLines.map((line, idx) => {
                const labelText = getPriceLabel(line.label || "");
                return (
                  <div
                    key={`${line.name}-${line.price_cents}-${idx}`}
                    className="p-4 sm:p-5 flex items-center justify-between gap-4 hover:bg-page/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="font-medium text-text-main">{line.name}</span>
                        {labelText && (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${getPriceTagClasses(
                              line.label || ""
                            )}`}
                          >
                            {labelText}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted mt-1 font-mono">
                        {line.quantity} × {formatCurrency(line.price_cents)}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-bold tabular-nums font-mono text-base text-text-main">
                        {formatCurrency(line.sum_cents)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Inactive Rows Section */}
          {report.inactive_rows && report.inactive_rows.length > 0 && (
            <div className="border-t-2 border-border bg-page/30 p-4 sm:p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                {uk.store.inactiveSectionTitle}
              </h4>
              <div className="divide-y divide-border/60">
                {report.inactive_rows.map((row, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-text-main">{row.name}</div>
                      <div className="text-xs text-text-muted">
                        {row.archived ? "В архіві" : "Неактивний"} · {row.lines}
                      </div>
                    </div>
                    <div className="text-right font-mono font-medium text-sm text-text-main tabular-nums">
                      {formatCurrency(row.sum_cents)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grand Total Footer */}
          <div className="p-4 sm:p-5 border-t border-border bg-page/60 flex items-center justify-between">
            <span className="font-bold text-text-main text-base sm:text-lg">Разом</span>
            <span className="font-bold tabular-nums font-mono text-lg sm:text-xl text-primary">
              {formatCurrency(report.total_cents)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
