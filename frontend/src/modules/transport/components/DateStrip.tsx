/**
 * A strip of days around the chosen one: each day shows how many orders are still in work and marks what
 * needs someone (new orders for the dispatcher, a taken car for the desk) and past days left open.
 */

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Shield } from "lucide-react";
import type { TransportDayDTO } from "@/platform/api/types";
import { uk, shiftDay } from "@/modules/transport/i18n";
import { dayTiming, stripDays } from "@/modules/transport/timing";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/utils";

const t = uk.transport;
const weekday = new Intl.DateTimeFormat("uk-UA", { weekday: "short", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("uk-UA", { month: "short", timeZone: "UTC" });

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return { weekday: weekday.format(date).replace(".", ""), day: d, month: monthShort.format(date).replace(".", ""), weekend: date.getUTCDay() % 6 === 0 };
}

export const STRIP_LENGTH = 14;

export function DateStrip({
  start,
  onStart,
  value,
  onChange,
  today,
  counts,
}: {
  start: string;
  onStart: (start: string) => void;
  value: string;
  onChange: (day: string) => void;
  today: string;
  counts: Map<string, TransportDayDTO>;
}) {
  // On a narrow screen the strip scrolls: keep the chosen day in sight.
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [value, start]);
  return (
    <div className="flex items-stretch gap-1.5">
      <Button variant="outline" size="icon" className="h-auto min-h-[44px] w-11 shrink-0" onClick={() => onStart(shiftDay(start, -7))} aria-label={t.earlierDays}>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </Button>
      <ol ref={list} aria-label={t.stripLabel} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {stripDays(start, STRIP_LENGTH).map((day) => {
          const p = parts(day);
          const c = counts.get(day);
          const open = c?.open ?? 0;
          const total = c?.total ?? 0;
          const attention = c?.attention ?? 0;
          const military = c?.military_open ?? 0;
          const timing = dayTiming(day, today);
          const past = timing.kind === "past";
          const selected = day === value;
          const isToday = timing.kind === "today";
          // The strongest mark wins: a past day left open, then orders waiting for this person, then orders in work.
          const mark = past && open > 0 ? "overdue" : attention > 0 ? "attention" : open > 0 ? "open" : total > 0 ? "closed" : "none";
          return (
            <li key={day} className="min-w-[3rem] flex-1">
              <button
                type="button"
                onClick={() => onChange(day)}
                aria-pressed={selected}
                aria-current={isToday ? "date" : undefined}
                aria-label={t.dayCell(`${p.weekday}, ${p.day} ${p.month}${isToday ? `, ${t.today.toLowerCase()}` : ""}`, open, total, attention, military)}
                className={cn(
                  "relative flex min-h-[44px] w-full flex-col items-center rounded-control border px-1 py-1.5 text-center transition-colors",
                  selected ? "border-primary bg-primary text-primary-fg" : isToday ? "border-primary bg-surface text-text-main" : "border-border bg-surface text-text-main hover:bg-surface-raised",
                  past && !selected && "opacity-75",
                )}
              >
                {military > 0 && <Shield aria-hidden="true" className="absolute right-1 top-1 h-3 w-3" />}
                <span className={cn("text-xs uppercase", !selected && (p.weekend ? "text-destructive" : "text-text-muted"))}>{p.weekday}</span>
                <span className="figure text-lg font-semibold leading-tight">{p.day}</span>
                <span className={cn("text-[0.6875rem] leading-none", !selected && "text-text-muted")}>{isToday ? t.today.toLowerCase() : p.month}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "figure mt-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-semibold",
                    mark === "overdue" && "bg-destructive text-destructive-fg",
                    mark === "attention" && "bg-attention text-page",
                    mark === "open" && (selected ? "bg-primary-fg text-primary" : "bg-primary text-primary-fg"),
                    mark === "closed" && (selected ? "text-primary-fg" : "text-text-muted"),
                  )}
                >
                  {mark === "none" ? "" : mark === "closed" ? "✓" : open}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Button variant="outline" size="icon" className="h-auto min-h-[44px] w-11 shrink-0" onClick={() => onStart(shiftDay(start, 7))} aria-label={t.laterDays}>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  );
}
