import { useEffect, useRef } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { MonthDaysDTO } from "@/platform/api/types";
import { shiftDay } from "@/platform/i18n";
import { uk, formatCurrency, formatDayReadable } from "@/modules/reports/i18n";
import { cn } from "@/ui/utils";

/** The month view in the strip (the sum of the days). */
export const MONTH_VIEW = "month";

const weekday = new Intl.DateTimeFormat("uk-UA", { weekday: "short", timeZone: "UTC" });

function weekdayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return weekday.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Every date from first to last (inclusive). */
export function daysBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 31; d = shiftDay(d, 1)) out.push(d);
  return out;
}

/** The day to open first: today in the current month, else the last day with entries, or the month's last day. */
export function defaultView(days: MonthDaysDTO): string {
  if (days.today.startsWith(days.period)) return days.today;
  if (days.days.length > 0) return days.days[days.days.length - 1].day;
  return days.last_day;
}

/**
 * The days of a month as a scrollable strip: «Місяць» (the sum, reviewers only), then each day up to today with its state (sent, draft, empty). With `onlyFilled`
 * (the reviewer) only the days with entries are listed.
 */
export function DayStrip({
  days,
  value,
  onChange,
  onlyFilled,
  withMonth,
}: {
  days: MonthDaysDTO;
  value: string;
  onChange: (view: string) => void;
  onlyFilled?: boolean;
  /** Offer «Місяць» (the read-only sum of the days; reviewers only). */
  withMonth?: boolean;
}) {
  const t = uk.daily;
  const listRef = useRef<HTMLDivElement>(null);
  const byDay = new Map(days.days.map((d) => [d.day, d]));
  const dates = onlyFilled ? days.days.map((d) => d.day) : daysBetween(days.first_day, days.last_day);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [value, days.period]);

  const chip = "flex min-h-[52px] shrink-0 flex-col items-center justify-center rounded-control border px-2.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  const tone = (active: boolean) =>
    active ? "border-ink bg-ink text-page" : "border-border bg-surface text-text-main hover:border-text-muted/60";

  return (
    <div role="group" aria-label={t.stripLabel} className="flex items-start gap-1.5">
      {/* «Місяць» stays in view; only the dates scroll. */}
      {withMonth && (
        <button type="button" aria-pressed={value === MONTH_VIEW} onClick={() => onChange(MONTH_VIEW)} className={cn(chip, "min-w-[5.5rem]", tone(value === MONTH_VIEW))}>
          <span className="font-medium">{t.month}</span>
          <span className="figure text-xs opacity-80">{formatCurrency(days.total_cents)}</span>
        </button>
      )}
      <div ref={listRef} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-2">
      {dates.map((day) => {
        const entry = byDay.get(day);
        const active = value === day;
        // A past day with nothing entered was closed at midnight.
        const closed = !entry && day < days.today;
        const base = entry ? (entry.status === "submitted" ? uk.store.statusSent : uk.store.statusDraft) : closed ? t.closedChip : t.empty;
        const state = entry?.missed ? `${base}, ${t.missedShort}` : base;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(day)}
            aria-label={`${formatDayReadable(day)}${day === days.today ? `, ${t.today}` : ""}: ${state}`}
            className={cn(
              chip,
              "w-[3.25rem]",
              tone(active),
              day === days.today && !active && "border-primary",
              entry?.missed && !active && "border-destructive/60",
              closed && !active && "text-text-muted",
            )}
          >
            <span className="text-[0.6875rem] uppercase opacity-75">{weekdayOf(day)}</span>
            <span className="figure text-base font-semibold leading-tight">{Number(day.slice(8))}</span>
            <span aria-hidden="true" className="grid h-3 place-items-center">
              {entry?.missed ? (
                <AlertTriangle className={cn("h-3 w-3", active ? "text-page" : "text-destructive")} strokeWidth={2.5} />
              ) : entry?.status === "submitted" ? (
                <Check className={cn("h-3 w-3", active ? "text-page" : "text-primary")} strokeWidth={3} />
              ) : entry ? (
                <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-page" : "bg-attention")} />
              ) : null}
            </span>
          </button>
        );
      })}
      </div>
    </div>
  );
}
