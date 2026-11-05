import React from "react";
import { cn } from "@/ui/utils";
import { uk } from "@/modules/reports/i18n";

export type ReportStatus = "submitted" | "draft" | "new" | "none";

interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: ReportStatus | string;
  customLabel?: string;
}

const styles: Record<string, { label: string; text: string; mark: string }> = {
  submitted: { label: uk.store.statusSent, text: "text-primary", mark: "bg-primary" },
  draft: { label: uk.store.statusDraft, text: "text-text-muted", mark: "border border-text-muted" },
  new: { label: uk.store.statusNew, text: "text-text-muted", mark: "border border-text-muted" },
  none: { label: "Немає звіту", text: "text-attention", mark: "bg-attention" },
};

/**
 * A report's state as a word in the ledger: spruce when sent, muted while a draft, amber when the
 * store has not reported. The mark repeats the state for people who scan by shape.
 */
export function StatusPill({ status, customLabel, className, ...props }: StatusPillProps) {
  const style = styles[status] ?? styles.none;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium", style.text, className)} {...props}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.mark)} />
      {customLabel || style.label}
    </span>
  );
}
