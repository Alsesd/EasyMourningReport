import { AlertCircle, CheckCircle, X } from "lucide-react";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";

export interface NoticeMessage {
  text: string;
  kind: "ok" | "err";
}

/** Dismissible success/error message announced to screen readers. */
export function Notice({
  message,
  onDismiss,
  dismissLabel,
}: {
  message: NoticeMessage | null;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <AnimatedCollapse open={Boolean(message)}>
      {message && (
        <div
          role="status"
          aria-live="polite"
          className={`py-1 pl-4 pr-1 rounded-control border border-l-[3px] flex items-center justify-between gap-3 text-sm ${
            message.kind === "ok"
              ? "bg-primary-soft border-primary/30 text-primary"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {message.kind === "ok" ? (
              <CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <span className="whitespace-pre-line break-words">{message.text}</span>
          </div>
          <button
            type="button"
            className="grid min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-control text-current opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onDismiss}
            aria-label={dismissLabel}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </AnimatedCollapse>
  );
}
