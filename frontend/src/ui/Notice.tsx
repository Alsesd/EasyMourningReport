import { AlertCircle, CheckCircle } from "lucide-react";
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
          className={`p-4 rounded-card border flex items-center justify-between gap-3 text-sm ${
            message.kind === "ok"
              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300"
              : "bg-destructive/10 border-destructive/25 text-destructive"
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
            className="text-text-muted hover:text-text-main rounded min-h-[44px] min-w-[44px] shrink-0"
            onClick={onDismiss}
            aria-label={dismissLabel}
          >
            ×
          </button>
        </div>
      )}
    </AnimatedCollapse>
  );
}
