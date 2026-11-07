import { SkeletonRows } from "@/ui/Skeleton";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/platform/api/client";
import { reportsApi } from "@/modules/reports/api";
import { Link } from "react-router-dom";
import { AccountMenu } from "@/platform/account/AccountMenu";
import { NotificationBell } from "@/platform/notifications/NotificationBell";
import { useAuth } from "@/platform/auth/AuthContext";
import { navItemsFor, useModuleRegistry } from "@/platform/modules";
import type { StoreReportDTO, ReportLineDTO, ReportSaveDTO } from "@/platform/api/types";
import { uk, formatCurrency, formatPeriodReadable, shiftPeriod } from "@/modules/reports/i18n";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/modules/reports/components/StatusPill";
import { Signature } from "@/modules/reports/components/Signature";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { MakerMark } from "@/ui/MakerMark";
import { ThemeToggle } from "@/ui/ThemeToggle";
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
  AlertCircle,
  CheckCircle2,
  Lock,
  ChevronDown,
  CloudOff,
  X,
} from "lucide-react";
import { cn } from "@/ui/utils";

export default function StoreReportPage() {
  const { session } = useAuth();
  // Users who can do more than file this report (or change their password) get a way into the workspace.
  const workspaceLink = navItemsFor(useModuleRegistry(), session?.permissions).find(
    (item) => item.to !== "/report",
  );
  const queryClient = useQueryClient();

  const currentMonth = session?.period || new Date().toISOString().slice(0, 7);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentMonth);

  useEffect(() => {
    document.title = `${session?.organisation?.name || uk.nav.report} — ${uk.appTitle}`;
  }, [session?.organisation?.name]);

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
        const inputKey = `${row.id}_${input.price_cents}`;
        initialMap[inputKey] = input.quantity;
        initialMap[`${inputKey}_calc`] = input.quantity_calc ?? 0;
      }
    }

    // Check if there is an unsubmitted local draft
    const localDraft = loadLocalDraft(selectedPeriod, session?.organisation?.id ?? undefined);
    if (localDraft && !report.read_only) {
      Object.assign(initialMap, localDraft.quantities);
    }

    setQuantities(initialMap);
    setInitialSnapshot(JSON.stringify(initialMap));
  }, [report, selectedPeriod, session?.organisation?.id]);

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
    (productId: number, priceCents: number, newQty: number, calculation = false) => {
      setQuantities((prev) => {
        const quantityKey = `${productId}_${priceCents}${calculation ? "_calc" : ""}`;
        const next = { ...prev, [quantityKey]: newQty };
        // Persist locally for offline draft protection
        saveLocalDraft(selectedPeriod, next, session?.organisation?.id ?? undefined);
        return next;
      });
    },
    [selectedPeriod, session?.organisation?.id]
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
            quantity_calc: Math.max(
              0,
              quantities[`${row.id}_${input.price_cents}_calc`] ?? input.quantity_calc ?? 0
            ),
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
      clearLocalDraft(selectedPeriod, session?.organisation?.id ?? undefined);

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
            : uk.store.saveError,
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

  const rows = report?.rows || [];
  const inactiveRows = report?.inactive_rows || [];
  const filled = rows.filter((row) => (row.inputs || []).some((input) => (quantities[`${row.id}_${input.price_cents}`] ?? input.quantity) > 0)).length;
  const locked = Boolean(report?.read_only) || saveMutation.isPending;
  const storeName = session?.organisation?.name || session?.login;

  return (
    <div className="flex min-h-screen flex-col bg-page pb-44 text-text-main sm:pb-28">
      <header className="sticky top-0 z-30 border-b border-border bg-page/95">
        <div className="mx-auto flex min-h-[60px] max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-primary font-serif text-sm font-semibold text-primary-fg">
              ЛЗ
            </span>
            <span className="truncate font-serif text-base font-semibold">{storeName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {workspaceLink && (
              <Link
                to={workspaceLink.to}
                aria-label={workspaceLink.label}
                title={workspaceLink.label}
                className="inline-flex h-11 min-w-[44px] items-center justify-center gap-2 rounded-control px-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:border sm:border-border sm:px-3"
              >
                <workspaceLink.icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                <span className="hidden sm:inline">{workspaceLink.label}</span>
              </Link>
            )}
            <MakerMark className="hidden sm:inline-flex" />
            <ThemeToggle />
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-text-muted">{uk.store.monthLabel}</p>
            <h1 className="text-[1.875rem] leading-tight sm:text-[2.25rem]">{formatPeriodReadable(selectedPeriod)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
              <StatusPill status={report?.status || "new"} />
              {report && <span>{uk.store.filledOf(filled, rows.length)}</span>}
              <Signature status={report?.status || "new"} signed={report ?? {}} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="icon" onClick={handlePreviousMonth} disabled={!canGoPrevious} aria-label={uk.store.previousMonth}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleNextMonth} disabled={!canGoNext} aria-label={uk.store.nextMonth}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {isOffline && (
          <p className="flex items-center gap-2 border-l-2 border-attention bg-attention-soft px-3 py-2 text-sm text-attention">
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            {uk.store.offlineNotice}
          </p>
        )}

        <AnimatedCollapse open={Boolean(feedback)}>
          {feedback && (
            <div
              role="alert"
              className={cn(
                "flex items-center gap-2.5 border-l-2 px-3 py-1 text-sm",
                feedback.type === "ok" ? "border-primary bg-primary-soft text-primary" : "border-destructive bg-destructive/10 text-destructive",
              )}
            >
              {feedback.type === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
              <span className="flex-1 py-1.5">{feedback.message}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                aria-label={uk.common.close}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-control opacity-70 hover:opacity-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </AnimatedCollapse>

        {report?.read_only && (
          <p className="flex items-center gap-2 border-l-2 border-primary bg-primary-soft px-3 py-2 text-sm text-primary">
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            {uk.store.readOnlyBanner}
          </p>
        )}

        {isLoading && <SkeletonRows rows={5} />}

        {isError && (
          <div role="alert" className="ledger space-y-3 py-6">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : uk.store.loadError}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              {uk.store.retry}
            </Button>
          </div>
        )}

        {report && (
          <section aria-label={uk.store.productsLabel}>
            <ul className="ledger divide-y divide-border">
              {rows.map((row: ReportLineDTO) => {
                const inputs = row.inputs && row.inputs.length > 0 ? row.inputs : [];
                const multi = inputs.length > 1;
                return (
                  <li key={row.id} className="py-3">
                    {multi && <p className="pb-1 font-medium text-text-main">{row.name}</p>}
                    <div className={cn(multi && "space-y-2 border-l-2 border-border pl-3")}>
                      {inputs.map((input) => {
                        const key = `${row.id}_${input.price_cents}`;
                        const qty = quantities[key] ?? input.quantity;
                        const lineSum = Math.max(0, qty) * input.price_cents;
                        const tag = getPriceLabel(input.label);
                        const label = `${row.name}, ${formatCurrency(input.price_cents)}`;
                        return (
                          <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_8.5rem]">
                            <div className="min-w-0">
                              {!multi && <p className="font-medium text-text-main">{row.name}</p>}
                              <p className="figure text-sm text-text-muted">
                                {formatCurrency(input.price_cents)}
                                {tag && <span className="ml-2 font-sans text-xs text-attention">{tag}</span>}
                              </p>
                              {lineSum > 0 && <p className="figure text-sm text-text-main sm:hidden">= {formatCurrency(lineSum)}</p>}
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                              <QuantityStepper value={qty} disabled={locked} label={label} onChange={(val) => handleQuantityChange(row.id, input.price_cents, val)} />
                              {report.calculation_enabled && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-text-muted">{uk.store.calculationShort}</span>
                                  <QuantityStepper
                                    value={quantities[`${key}_calc`] ?? input.quantity_calc ?? 0}
                                    disabled={locked}
                                    label={`${uk.store.calculationQuantity}: ${label}`}
                                    onChange={(val) => handleQuantityChange(row.id, input.price_cents, val, true)}
                                  />
                                </div>
                              )}
                            </div>
                            <p className={cn("figure hidden text-right text-[1.0625rem] sm:block", lineSum > 0 ? "text-text-main" : "text-text-muted/50")}>
                              {formatCurrency(lineSum)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>

            {inactiveRows.length > 0 && (
              <details className="group border-t border-border">
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 py-2 [&::-webkit-details-marker]:hidden">
                  <span className="text-sm font-medium text-text-muted">
                    {uk.store.inactiveSectionTitle} ({inactiveRows.length})
                  </span>
                  <span className="flex items-center gap-3">
                    {report.inactive_total_cents > 0 && <span className="figure text-sm text-text-main">{formatCurrency(report.inactive_total_cents)}</span>}
                    <ChevronDown className="h-4 w-4 text-text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
                  </span>
                </summary>
                <p className="pb-2 text-xs text-text-muted">{uk.store.inactiveHelp}</p>
                <ul className="divide-y divide-border border-l-2 border-border pl-3 text-sm">
                  {inactiveRows.map((inRow, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block text-text-main">{inRow.name}</span>
                        <span className="figure block text-xs text-text-muted">{inRow.lines}</span>
                      </span>
                      <span className="figure text-text-main">{formatCurrency(inRow.sum_cents)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </main>

      {/* The month's total and the two actions stay in reach while the list scrolls. */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 border-t-2 border-ink bg-page pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
          <div className="min-w-0">
            <span className="block text-xs text-text-muted">
              {uk.store.monthTotal}
              {isDirty && (
                <span role="status" className="ml-2 font-medium text-attention">
                  {uk.store.unsavedChanges}
                </span>
              )}
            </span>
            <span className="figure block text-[1.375rem] font-semibold leading-tight text-text-main">{formatCurrency(overallTotalCents)}</span>
          </div>

          {!report?.read_only ? (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <Button
                variant="outline"
                onClick={() => saveMutation.mutate("draft")}
                disabled={saveMutation.isPending || !report}
                isLoading={saveMutation.isPending && saveMutation.variables === "draft"}
                className="px-3"
              >
                {saveMutation.isPending && saveMutation.variables === "draft" ? uk.store.savingDraft : uk.store.saveDraft}
              </Button>
              <Button onClick={() => setIsSubmitConfirmOpen(true)} disabled={saveMutation.isPending || !report} className="px-3">
                {uk.store.submitReport}
              </Button>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <Lock className="h-4 w-4" aria-hidden="true" />
              {uk.store.statusSent}
            </span>
          )}
        </div>
      </footer>

      <Dialog open={isSubmitConfirmOpen} onOpenChange={setIsSubmitConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{uk.store.confirmSubmitTitle}</DialogTitle>
            <DialogDescription>{uk.store.confirmSubmitMessage}</DialogDescription>
          </DialogHeader>
          <dl className="ledger double-rule grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 py-3 text-sm">
            <dt className="text-text-muted">{uk.store.periodLabel}</dt>
            <dd className="text-right font-medium text-text-main">{formatPeriodReadable(selectedPeriod)}</dd>
            <dt className="text-text-muted">{uk.store.monthTotal}</dt>
            <dd className="figure text-right text-base font-semibold text-text-main">{formatCurrency(overallTotalCents)}</dd>
          </dl>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsSubmitConfirmOpen(false)} disabled={saveMutation.isPending}>
              {uk.store.cancelButton}
            </Button>
            <Button
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
