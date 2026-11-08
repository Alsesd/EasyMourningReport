import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDayReadable, formatDayShort, shiftDay, todayIso } from "@/platform/i18n";
import { useMediaQuery } from "@/ui/useMediaQuery";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/utils";

/** Days offered in the list: a month back up to three months ahead, plus the selected one. */
export function dayOptions(value: string, today: string = todayIso()): string[] {
  const options = new Set<string>();
  for (let delta = -31; delta <= 92; delta++) options.add(shiftDay(today, delta));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) options.add(value);
  return [...options].sort();
}

/**
 * Day selector in Ukrainian: previous / day list / next. Like PeriodPicker it replaces the native date input,
 * which renders in the browser's language.
 */
export function DayPicker({
  value,
  onChange,
  labels,
  className,
  compact,
}: {
  value: string;
  onChange: (day: string) => void;
  labels: { previous: string; next: string; day: string; today?: string };
  className?: string;
  /** Only the list, without the arrows and the "today" button (inside forms). */
  compact?: boolean;
}) {
  const today = todayIso();
  // Phones get the short form, so the label with «сьогодні» fits between the arrows.
  const wide = useMediaQuery("(min-width: 480px)");
  const format = wide ? formatDayReadable : formatDayShort;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-2">
      {!compact && (
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => onChange(shiftDay(value, -1))} aria-label={labels.previous}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={labels.day}
        className="h-11 min-w-0 flex-1 truncate rounded-control border border-border bg-surface px-3 text-[0.9375rem] font-medium text-text-main hover:border-text-muted/50"
      >
        {dayOptions(value, today).map((day) => (
          <option key={day} value={day}>
            {format(day)}
            {day === today ? " · сьогодні" : ""}
          </option>
        ))}
      </select>
      {!compact && (
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => onChange(shiftDay(value, 1))} aria-label={labels.next}>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      )}
      </div>
      {!compact && labels.today && value !== today && (
        <Button variant="outline" className="min-h-[44px]" onClick={() => onChange(today)}>
          {labels.today}
        </Button>
      )}
    </div>
  );
}
