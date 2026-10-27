import React from "react";
import { cn } from "@/shared/lib/utils";
import { uk } from "@/shared/i18n/uk";

export type ReportStatus = "submitted" | "draft" | "new" | "none";

interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: ReportStatus | string;
  customLabel?: string;
}

export function StatusPill({ status, customLabel, className, ...props }: StatusPillProps) {
  let label = customLabel;
  let colorClasses = "bg-pill-none-bg text-pill-none-text border border-border/50";

  switch (status) {
    case "submitted":
      label = label || uk.store.statusSent;
      colorClasses = "bg-pill-sent-bg text-pill-sent-text font-medium border border-emerald-500/25";
      break;
    case "draft":
      label = label || uk.store.statusDraft;
      colorClasses = "bg-pill-draft-bg text-pill-draft-text font-medium border border-amber-500/25";
      break;
    case "new":
      label = label || uk.store.statusNew;
      colorClasses = "bg-pill-none-bg text-pill-none-text border border-border/50";
      break;
    case "none":
    default:
      label = label || "Немає звіту";
      colorClasses = "bg-pill-none-bg text-pill-none-text border border-border/50";
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs transition-colors select-none shadow-2xs",
        colorClasses,
        className
      )}
      role="status"
      {...props}
    >
      {label}
    </span>
  );
}
