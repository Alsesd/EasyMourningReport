import { cn } from "@/ui/utils";
import { uk } from "@/modules/transport/i18n";

const tone: Record<string, { text: string; mark: string }> = {
  submitted: { text: "text-attention", mark: "bg-attention" },
  partial: { text: "text-attention", mark: "border border-attention" },
  planned: { text: "text-primary", mark: "border border-primary" },
  delivered: { text: "text-text-main", mark: "bg-text-main" },
  cancelled: { text: "text-text-muted", mark: "border border-text-muted" },
  rejected: { text: "text-destructive", mark: "bg-destructive" },
};

/** A request's derived state as a word with a mark. */
export function RequestStatusPill({ status, className }: { status: string; className?: string }) {
  const t = tone[status] ?? tone.cancelled;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium", t.text, className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.mark)} />
      {uk.transport.requestStatuses[status] ?? status}
    </span>
  );
}
