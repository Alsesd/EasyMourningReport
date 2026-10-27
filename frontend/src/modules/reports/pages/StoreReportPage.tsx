import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/platform/api/client";
import { reportsApi } from "@/modules/reports/api";
import { useAuth } from "@/platform/auth/AuthContext";
import type { StoreReportDTO, ReportLineDTO, ReportSaveDTO } from "@/platform/api/types";
import { uk, formatCurrency, formatPeriodReadable, shiftPeriod } from "@/modules/reports/i18n";
import { Card, CardHeader, CardTitle, CardContent } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/ui/StatusPill";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { MakerMark } from "@/ui/MakerMark";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/ui/Dialog";
import { saveLocalDraft, loadLocalDraft, clearLocalDraft } from "@/platform/offline/offlineDrafts";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Lock,
  ChevronDown,
  CloudOff,
  Table as TableIcon,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/ui/utils";

export default function StoreReportPage() {
  const { session, logout } = useAuth();
  const queryClient = useQueryClient();

  const currentMonth = session?.period || new Date().toISOString().slice(0, 7);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentMonth);

  useEffect(() => {
    document.title = `${session?.store_name || uk.nav.report} — ${uk.appTitle}`;
  }, [session?.store_name]);

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 640;
  const storedViewMode = typeof window !== "undefined" ? (localStorage.getItem("store.viewMode") as "desktop" | "cards" | null) : null;
  const [viewMode, setViewMode] = useState<"desktop" | "cards">(storedViewMode || (isDesktop ? "desktop" : "cards"));

  const handleSetViewMode = (mode: "desktop" | "cards") => {
    setViewMode(mode);
    try {
      localStorage.setItem("store.viewMode", mode);
    } catch {
      // Ignore storage errors (e.g. private browsing mode)
    }
  };

  // Map of `${productId}_${priceCents}` -> quantity
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; message: string } | null>(null);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Fetch report for the selected period
  const {
    data: report,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<StoreReportDTO>({
    queryKey: ["storeReport", selectedPeriod],
    queryFn: async () => {
      return await reportsApi.storeReport(selectedPeriod);
    },
    staleTime: 60 * 1000,
  });

  // Initialize quantities when report data loads
  useEffect(() => {
    if (!report) return;

    const initialMap: Record<string, number> = {};
    for (const row of report.rows || []) {
      for (const input of row.inputs || []) {
        initialMap[`${row.id}_${input.price_cents}`] = input.quantity;
      }
    }

    // Check if there is an unsubmitted local draft
    const localDraft = loadLocalDraft(selectedPeriod, session?.store_id ?? undefined);
    if (localDraft && !report.read_only) {
      Object.assign(initialMap, localDraft.quantities);
    }

    setQuantities(initialMap);
    setInitialSnapshot(JSON.stringify(initialMap));
  }, [report, selectedPeriod, session?.store_id]);

  // Clear feedback when switching periods
  useEffect(() => {
    setFeedback(null);
  }, [selectedPeriod]);

  // Compute dirty state
  const isDirty = useMemo(() => {
    if (!report || report.read_only) return false;
    return JSON.stringify(quantities) !== initialSnapshot;
  }, [quantities, initialSnapshot, report]);

  // Navigation guard against accidental tab closure when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = uk.store.unsavedBeforeUnload;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Handle quantity changes
  const handleQuantityChange = useCallback(
    (productId: number, priceCents: number, newQty: number) => {
      setQuantities((prev) => {
        const next = { ...prev, [`${productId}_${priceCents}`]: newQty };
        // Persist locally for offline draft protection
        saveLocalDraft(selectedPeriod, next, session?.store_id ?? undefined);
        return next;
      });
    },
    [selectedPeriod, session?.store_id]
  );

  // Compute live totals
  const { overallTotalCents } = useMemo(() => {
    if (!report) return { editableTotalCents: 0, overallTotalCents: 0 };

    let total = 0;
    for (const row of report.rows || []) {
      for (const input of row.inputs || []) {
        const qty = quantities[`${row.id}_${input.price_cents}`] ?? input.quantity;
        total += Math.max(0, qty) * input.price_cents;
      }
    }
    const inactiveTotal = report.inactive_total_cents || 0;
    return {
      editableTotalCents: total,
      overallTotalCents: total + inactiveTotal,
    };
  }, [report, quantities]);

  // Mutation to save draft or submit
  const saveMutation = useMutation({
    mutationFn: async (action: "draft" | "submit") => {
      if (!report) throw new Error("No report loaded");

      const items: ReportSaveDTO["quantities"] = [];
      for (const row of report.rows || []) {
        for (const input of row.inputs || []) {
          const qty = quantities[`${row.id}_${input.price_cents}`] ?? input.quantity;
          items.push({
            product_id: row.id,
            price_cents: input.price_cents,
            quantity: Math.max(0, qty),
          });
        }
      }

      const payload: ReportSaveDTO = {
        action,
        quantities: items,
      };

      return await reportsApi.saveStoreReport(selectedPeriod, payload);
    },
    onSuccess: (updatedReport, action) => {
      queryClient.setQueryData(["storeReport", selectedPeriod], updatedReport);
      setInitialSnapshot(JSON.stringify(quantities));
      clearLocalDraft(selectedPeriod, session?.store_id ?? undefined);

      setFeedback({
        type: "ok",
        message: action === "submit" ? uk.store.reportSubmitted : uk.store.draftSaved,
      });

      if (action === "submit") {
        setIsSubmitConfirmOpen(false);
      }
    },
    onError: (err) => {
      setFeedback({
        type: "err",
        message:
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Не вдалося зберегти звіт",
      });
    },
  });

  // Period navigation
  const periods = useMemo(() => report?.available_periods || [], [report?.available_periods]);
  const periodIdx = periods.indexOf(selectedPeriod);

  const previousPeriod = useMemo(() => {
    if (periodIdx > 0) return periods[periodIdx - 1];
    if (periodIdx === -1) {
      const prev = periods.filter((p) => p < selectedPeriod);
      if (prev.length > 0) return prev[prev.length - 1];
      return shiftPeriod(selectedPeriod, -1);
    }
    return null;
  }, [periods, periodIdx, selectedPeriod]);

  const nextPeriod = useMemo(() => {
    if (periodIdx >= 0 && periodIdx < periods.length - 1) {
      const next = periods[periodIdx + 1];
      return next <= currentMonth ? next : null;
    }
    if (periodIdx === -1) {
      const nextList = periods.filter((p) => p > selectedPeriod && p <= currentMonth);
      if (nextList.length > 0) return nextList[0];
      const shifted = shiftPeriod(selectedPeriod, 1);
      return shifted <= currentMonth ? shifted : null;
    }
    return null;
  }, [periods, periodIdx, selectedPeriod, currentMonth]);

  const canGoPrevious = Boolean(previousPeriod);
  const canGoNext = Boolean(nextPeriod);

  const handlePreviousMonth = () => {
    if (previousPeriod) {
      setSelectedPeriod(previousPeriod);
    }
  };

  const handleNextMonth = () => {
    if (nextPeriod) {
      setSelectedPeriod(nextPeriod);
    }
  };

  const getPriceLabel = (label: string) => {
    if (label === "old") return uk.store.priceOldTag;
    if (label === "new") return uk.store.priceNewTag;
    if (label === "saved") return uk.store.priceSavedTag;
    return "";
  };

  return (
    <div className="store-report-shell min-h-screen bg-page text-text-main pb-28 flex flex-col animate-fade-in">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur-xs border-b border-border shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <h1 className="font-bold text-base sm:text-lg text-primary truncate">
              {session?.store_name || session?.login}
            </h1>
            <p className="text-xs text-text-muted">{uk.appTitle}</p>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {/* View Mode Toggle (Desktop vs Cards) */}
            <div className="flex items-center bg-page p-1 rounded-control border border-border">
              <button
                type="button"
                onClick={() => handleSetViewMode("desktop")}
                className={cn(
                  "flex items-center px-2 py-1 rounded-lg text-xs font-medium transition-all active:scale-95",
                  viewMode === "desktop"
                    ? "bg-surface text-primary shadow-2xs font-semibold"
                    : "text-text-muted hover:text-text-main"
                )}
                title={uk.store.desktopMode}
                aria-label={uk.store.desktopMode}
              >
                <TableIcon className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">{uk.store.desktopMode}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode("cards")}
                className={cn(
                  "flex items-center px-2 py-1 rounded-lg text-xs font-medium transition-all active:scale-95",
                  viewMode === "cards"
                    ? "bg-surface text-primary shadow-2xs font-semibold"
                    : "text-text-muted hover:text-text-main"
                )}
                title={uk.store.cardsMode}
                aria-label={uk.store.cardsMode}
              >
                <LayoutGrid className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">{uk.store.cardsMode}</span>
              </button>
            </div>

            <MakerMark />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              aria-label={uk.auth.logoutButton}
              title={uk.auth.logoutButton}
              className="h-9 w-9 text-text-muted hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-4 space-y-4 flex-1">
        {/* Offline & Status Notice */}
        {isOffline && (
          <div className="flex items-center space-x-2 px-3 py-2 rounded-control bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium animate-slide-down">
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>{uk.store.offlineBadge} · {uk.store.pendingSyncBadge}</span>
          </div>
        )}

        {/* Feedback Alert */}
        <AnimatedCollapse open={Boolean(feedback)}>
          {feedback && (
            <div
              role="alert"
              className={cn(
                "flex items-start space-x-2.5 p-3 rounded-control text-xs sm:text-sm font-medium border shadow-xs transition-all",
                feedback.type === "ok"
                  ? "bg-pill-sent-bg/50 border-pill-sent-text/25 text-pill-sent-text"
                  : "bg-destructive/10 border-destructive/25 text-destructive"
              )}
            >
              {feedback.type === "ok" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <div className="flex-1">{feedback.message}</div>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-current opacity-70 hover:opacity-100 p-0.5"
              >
                ✕
              </button>
            </div>
          )}
        </AnimatedCollapse>

        {/* Period Switcher Card */}
        <Card className="shadow-2xs">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                size="icon"
                onClick={handlePreviousMonth}
                disabled={!canGoPrevious}
                aria-label={uk.store.previousMonth}
                className="transition-transform active:scale-95"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>

              <div className="text-center">
                <span className="text-base sm:text-lg font-bold text-text-main block">
                  {formatPeriodReadable(selectedPeriod)}
                </span>
                <div className="mt-1">
                  <StatusPill status={report?.status || "new"} />
                </div>
              </div>

              <Button
                variant="secondary"
                size="icon"
                onClick={handleNextMonth}
                disabled={!canGoNext}
                aria-label={uk.store.nextMonth}
                className="transition-transform active:scale-95"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Read-only Banner */}
        {report?.read_only && (
          <div className="flex items-center space-x-2 px-3 py-2.5 rounded-control bg-pill-sent-bg/40 border border-pill-sent-text/20 text-pill-sent-text text-xs font-medium">
            <Lock className="h-4 w-4 shrink-0" />
            <span>{uk.store.readOnlyBanner}</span>
          </div>
        )}

        {/* Unsaved Changes Indicator */}
        {isDirty && (
          <div
            role="status"
            className="flex items-center justify-between px-3 py-2 rounded-control bg-pill-draft-bg/60 border border-pill-draft-text/20 text-pill-draft-text text-xs font-semibold animate-pulse-subtle"
          >
            <span>{uk.store.unsavedChanges}</span>
            <span className="text-[11px] opacity-80">Чернетку не збережено</span>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="py-12 text-center text-text-muted space-y-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
            <p className="text-xs">{uk.common.loading}</p>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <Card className="border-destructive/30 animate-slide-down">
            <CardContent className="p-6 text-center space-y-3">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
              <p className="text-sm font-medium text-destructive">
                {error instanceof Error ? error.message : "Не вдалося завантажити звіт."}
              </p>
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Спробувати знову
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Product Items: Desktop Table View vs Cards View */}
        {report && (
          <div className="space-y-4">
            {viewMode === "desktop" ? (
              /* Desktop Mode: High-efficiency data-entry table */
              <div className="rounded-card border border-border bg-surface overflow-x-auto shadow-xs animate-fade-in">
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="sticky top-0 z-20 bg-surface border-b border-border shadow-2xs">
                    <tr className="bg-page/70 text-text-muted text-xs uppercase tracking-wider font-semibold">
                      <th className="py-3 px-4 min-w-[200px]">{uk.summary.tableProduct}</th>
                      <th className="py-3 px-4 text-right min-w-[120px]">{uk.summary.tablePrice}</th>
                      <th className="py-3 px-4 text-center min-w-[160px]">{uk.summary.tableTotalQuantity}</th>
                      <th className="py-3 px-4 text-right min-w-[130px]">{uk.summary.tableTotalSum}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(report.rows || []).map((row: ReportLineDTO) => {
                      const inputs =
                        row.inputs && row.inputs.length > 0
                          ? row.inputs
                          : [{ price_cents: 0, quantity: 0, label: "", sum_cents: 0 }];
                      return inputs.map((input, iIdx) => {
                        const inputKey = `${row.id}_${input.price_cents}`;
                        const currentQty = quantities[inputKey] ?? input.quantity;
                        const lineSumCents = Math.max(0, currentQty) * input.price_cents;
                        const labelText = getPriceLabel(input.label);

                        return (
                          <tr
                            key={inputKey}
                            className="even:bg-page/20 hover:bg-page/50 transition-colors"
                          >
                            {iIdx === 0 && (
                              <td
                                rowSpan={inputs.length}
                                className="py-3 px-4 align-top border-r border-border/30"
                              >
                                <span className="font-semibold text-text-main block">{row.name}</span>
                              </td>
                            )}
                            <td className="py-3 px-4 text-right tabular-nums font-mono font-bold text-text-main whitespace-nowrap">
                              <span>{formatCurrency(input.price_cents)}</span>
                              {labelText && (
                                <span className="inline-block ml-2 text-[10px] font-medium text-primary px-1.5 py-0.5 rounded bg-accent-soft">
                                  {labelText}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="inline-flex justify-center">
                                <QuantityStepper
                                  value={currentQty}
                                  disabled={report.read_only || saveMutation.isPending}
                                  onChange={(val) => handleQuantityChange(row.id, input.price_cents, val)}
                                />
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums font-mono font-bold text-primary text-base whitespace-nowrap">
                              {lineSumCents > 0 ? (
                                formatCurrency(lineSumCents)
                              ) : (
                                <span className="text-text-muted/40 font-normal text-sm">0.00 ₴</span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Cards View: Compact card layout */
              <div className="space-y-3 animate-fade-in">
                {(report.rows || []).map((row: ReportLineDTO) => {
                  const inputs = row.inputs || [];
                  const isRepriced = row.repriced || inputs.length > 1;

                  const rowTotalCents = inputs.reduce((sum, input) => {
                    const qty = quantities[`${row.id}_${input.price_cents}`] ?? input.quantity;
                    return sum + Math.max(0, qty) * input.price_cents;
                  }, 0);

                  return (
                    <Card key={row.id} className="overflow-hidden shadow-2xs border-border hover:border-primary/40 transition-colors">
                      <CardHeader className="p-3.5 pb-2">
                        <div className="flex justify-between items-start gap-2">
                          <CardTitle className="text-base font-semibold text-text-main leading-snug">
                            {row.name}
                          </CardTitle>
                          {rowTotalCents > 0 && (
                            <span className="text-sm font-bold text-primary shrink-0">
                              {formatCurrency(rowTotalCents)}
                            </span>
                          )}
                        </div>
                      </CardHeader>

                      <CardContent className="p-3.5 pt-1 space-y-2.5">
                        {inputs.map((input) => {
                          const inputKey = `${row.id}_${input.price_cents}`;
                          const currentQty = quantities[inputKey] ?? input.quantity;
                          const lineSumCents = Math.max(0, currentQty) * input.price_cents;
                          const labelText = getPriceLabel(input.label);

                          return (
                            <div
                              key={inputKey}
                              className={cn(
                                "flex items-center justify-between gap-3 pt-1",
                                isRepriced && "pb-2 border-b border-border/40 last:border-0 last:pb-0"
                              )}
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-sm text-text-main">
                                  {formatCurrency(input.price_cents)}
                                </span>
                                {labelText && (
                                  <span className="block text-[11px] font-medium text-primary mt-0.5">
                                    {labelText}
                                  </span>
                                )}
                                {lineSumCents > 0 && (
                                  <span className="block text-xs text-text-muted mt-0.5">
                                    = {formatCurrency(lineSumCents)}
                                  </span>
                                )}
                              </div>

                              <QuantityStepper
                                value={currentQty}
                                disabled={report.read_only || saveMutation.isPending}
                                onChange={(val) => handleQuantityChange(row.id, input.price_cents, val)}
                              />
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Collapsed Inactive Items Section */}
            {(report.inactive_rows || []).length > 0 && (
              <details className="group rounded-card border border-border bg-surface overflow-hidden shadow-2xs">
                <summary className="flex items-center justify-between p-3.5 cursor-pointer list-none select-none hover:bg-page transition-colors">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-sm text-text-muted">
                      {uk.store.inactiveSectionTitle} ({(report.inactive_rows || []).length})
                    </span>
                    {report.inactive_total_cents > 0 && (
                      <span className="text-xs font-semibold text-text-main">
                        · {formatCurrency(report.inactive_total_cents)}
                      </span>
                    )}
                  </div>
                  <ChevronDown className="h-4 w-4 text-text-muted transition-transform group-open:rotate-180" />
                </summary>
                <div className="p-3.5 pt-0 border-t border-border/40 space-y-2 text-xs text-text-muted">
                  <p className="text-[11px] py-1 text-text-muted/80">{uk.store.inactiveHelp}</p>
                  {(report.inactive_rows || []).map((inRow, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center py-1.5 border-b border-border/20 last:border-0"
                    >
                      <div>
                        <span className="font-medium text-text-main block">{inRow.name}</span>
                        <span className="text-[11px] text-text-muted">{inRow.lines}</span>
                      </div>
                      <span className="font-semibold text-text-main">
                        {formatCurrency(inRow.sum_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </main>

      {/* Sticky Bottom Action Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-surface/98 backdrop-blur-md border-t border-border shadow-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div>
            <span className="text-[11px] font-medium text-text-muted block leading-none">
              {uk.store.monthTotal}
            </span>
            <span className="text-lg sm:text-xl font-bold text-primary block leading-tight mt-0.5 font-mono">
              {formatCurrency(overallTotalCents)}
            </span>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {!report?.read_only ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => saveMutation.mutate("draft")}
                  disabled={saveMutation.isPending || !report}
                  isLoading={saveMutation.isPending && saveMutation.variables === "draft"}
                  className="transition-transform active:scale-95"
                >
                  {saveMutation.isPending && saveMutation.variables === "draft"
                    ? uk.store.savingDraft
                    : uk.store.saveDraft}
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsSubmitConfirmOpen(true)}
                  disabled={saveMutation.isPending || !report}
                  className="transition-transform active:scale-95 shadow-xs"
                >
                  {uk.store.submitReport}
                </Button>
              </>
            ) : (
              <span className="text-xs font-semibold text-pill-sent-text bg-pill-sent-bg px-3 py-1.5 rounded-full flex items-center space-x-1">
                <Lock className="h-3 w-3 inline mr-1" />
                {uk.store.statusSent}
              </span>
            )}
          </div>
        </div>
      </footer>

      {/* Confirmation Dialog on Submit */}
      <Dialog open={isSubmitConfirmOpen} onOpenChange={setIsSubmitConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{uk.store.confirmSubmitTitle}</DialogTitle>
            <DialogDescription>{uk.store.confirmSubmitMessage}</DialogDescription>
          </DialogHeader>
          <div className="p-3 my-2 rounded-control bg-page border border-border text-xs text-text-muted space-y-1">
            <div className="flex justify-between">
              <span>Період:</span>
              <span className="font-semibold text-text-main">
                {formatPeriodReadable(selectedPeriod)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Загальна сума:</span>
              <span className="font-semibold text-primary font-mono">{formatCurrency(overallTotalCents)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setIsSubmitConfirmOpen(false)}
              disabled={saveMutation.isPending}
            >
              {uk.store.cancelButton}
            </Button>
            <Button
              variant="primary"
              onClick={() => saveMutation.mutate("submit")}
              isLoading={saveMutation.isPending && saveMutation.variables === "submit"}
              disabled={saveMutation.isPending}
            >
              {uk.store.confirmSubmitButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
