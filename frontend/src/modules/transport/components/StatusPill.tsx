import { cn } from "@/ui/utils";
import { uk } from "@/modules/transport/i18n";
import { orderTiming, type TimingKind } from "@/modules/transport/timing";

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

const timingTone: Record<TimingKind, string> = {
  overdue: "bg-destructive/10 text-destructive",
  today: "bg-attention text-page",
  tomorrow: "bg-primary-soft text-primary",
  dayAfter: "border border-primary/40 text-primary",
  later: "border border-border text-text-muted",
  past: "text-text-muted",
};

/** When the order is due, relative to today: "Терміново · сьогодні", "Завтра", "Через 7 днів", "Не закрито". */
export function OrderTiming({ serviceDate, status, today, className }: { serviceDate: string; status: string; today: string; className?: string }) {
  const { kind, days } = orderTiming(serviceDate, status, today);
  const t = uk.transport.timing;
  const label = kind === "overdue" ? t.overdue(days) : kind === "later" ? t.later(days) : kind === "past" ? t.past : t[kind];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-control px-2 py-0.5 text-xs font-semibold", timingTone[kind], className)}
      data-timing={kind}
    >
      {(kind === "today" || kind === "overdue") && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {label}
    </span>
  );
}
