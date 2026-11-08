import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { MonthDaysDTO } from "@/platform/api/types";
import { shiftDay } from "@/platform/i18n";
import { UNDATED } from "@/modules/reports/api";
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

/** The day to open first: today in the current month, else the last day with entries, the undated part, or the month. */
export function defaultView(days: MonthDaysDTO): string {
  if (days.today.startsWith(days.period)) return days.today;
  if (days.days.length > 0) return days.days[days.days.length - 1].day;
  if (days.undated) return UNDATED;
  return MONTH_VIEW;
}

/**
 * The days of a month as a scrollable strip: «Місяць» (the sum), «Без дати» when the month has quantities entered
 * before it was kept by days, then each day up to today with its state (sent, draft, empty). With `onlyFilled`
 * (the reviewer) only the days with entries are listed.
 */
export function DayStrip({
  days,
  value,
  onChange,
  onlyFilled,
}: {
  days: MonthDaysDTO;
  value: string;
  onChange: (view: string) => void;
  onlyFilled?: boolean;
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
    <div ref={listRef} role="group" aria-label={t.stripLabel} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
      <button type="button" aria-pressed={value === MONTH_VIEW} onClick={() => onChange(MONTH_VIEW)} className={cn(chip, "min-w-[5.5rem]", tone(value === MONTH_VIEW))}>
        <span className="font-medium">{t.month}</span>
        <span className="figure text-xs opacity-80">{formatCurrency(days.total_cents)}</span>
      </button>
      {days.undated && (
        <button
          type="button"
          aria-pressed={value === UNDATED}
          onClick={() => onChange(UNDATED)}
          aria-label={`${t.undated}: ${days.undated.status === "submitted" ? uk.store.statusSent : uk.store.statusDraft}`}
          className={cn(chip, "min-w-[5.5rem]", tone(value === UNDATED))}
        >
          <span className="font-medium">{t.undatedShort}</span>
          <span className="figure text-xs opacity-80">{formatCurrency(days.undated.total_cents)}</span>
        </button>
      )}
      {dates.map((day) => {
        const entry = byDay.get(day);
        const active = value === day;
        const state = entry ? (entry.status === "submitted" ? uk.store.statusSent : uk.store.statusDraft) : t.empty;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(day)}
            aria-label={`${formatDayReadable(day)}${day === days.today ? `, ${t.today}` : ""}: ${state}`}
            className={cn(chip, "w-[3.25rem]", tone(active), day === days.today && !active && "border-primary")}
          >
            <span className="text-[0.6875rem] uppercase opacity-75">{weekdayOf(day)}</span>
            <span className="figure text-base font-semibold leading-tight">{Number(day.slice(8))}</span>
            <span aria-hidden="true" className="grid h-3 place-items-center">
              {entry?.status === "submitted" ? (
                <Check className={cn("h-3 w-3", active ? "text-page" : "text-primary")} strokeWidth={3} />
              ) : entry ? (
                <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-page" : "bg-attention")} />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
