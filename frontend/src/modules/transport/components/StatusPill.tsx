import { cn } from "@/ui/utils";
import { uk } from "@/modules/transport/i18n";

const tone: Record<string, { text: string; mark: string }> = {
  submitted: { text: "text-attention", mark: "bg-attention" },
  accepted: { text: "text-primary", mark: "border border-primary" },
  in_progress: { text: "text-primary", mark: "bg-primary" },
  done: { text: "text-text-main", mark: "bg-text-main" },
  rejected: { text: "text-destructive", mark: "bg-destructive" },
  cancelled: { text: "text-text-muted", mark: "border border-text-muted" },
  bumped: { text: "text-destructive", mark: "border border-destructive" },
};

/** An order's state as a word with a mark (the mark repeats it for people who scan by shape). */
export function OrderStatus({ status, className }: { status: string; className?: string }) {
  const t = tone[status] ?? tone.cancelled;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium", t.text, className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", t.mark)} />
      {uk.transport.statuses[status] ?? status}
    </span>
  );
}
