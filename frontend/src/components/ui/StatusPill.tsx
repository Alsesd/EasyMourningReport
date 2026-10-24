import React from "react";
import { cn } from "@/lib/utils";
import { uk } from "@/i18n/uk";

export type ReportStatus = "submitted" | "draft" | "new" | "none";

interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: ReportStatus | string;
  customLabel?: string;
}

export function StatusPill({ status, customLabel, className, ...props }: StatusPillProps) {
  let label = customLabel;
  let colorClasses = "bg-pill-none-bg text-pill-none-text";

  switch (status) {
    case "submitted":
      label = label || uk.store.statusSent;
      colorClasses = "bg-pill-sent-bg text-pill-sent-text font-medium";
      break;
    case "draft":
      label = label || uk.store.statusDraft;
      colorClasses = "bg-pill-draft-bg text-pill-draft-text font-medium";
      break;
    case "new":
      label = label || uk.store.statusNew;
      colorClasses = "bg-pill-none-bg text-pill-none-text";
      break;
    case "none":
    default:
      label = label || "Немає звіту";
      colorClasses = "bg-pill-none-bg text-pill-none-text";
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs transition-colors select-none",
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
