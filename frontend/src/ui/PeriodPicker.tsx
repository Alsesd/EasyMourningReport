import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatPeriodReadable, shiftPeriod } from "@/platform/i18n";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/utils";

/** Months offered in the list: three years back up to next month, plus the selected one. */
export function periodOptions(value: string, today: Date = new Date()): string[] {
  const current = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const options = new Set<string>();
  for (let delta = 1; delta >= -36; delta--) options.add(shiftPeriod(current, delta));
  if (/^\d{4}-\d{2}$/.test(value)) options.add(value);
  return [...options].sort().reverse();
}

/**
 * Month selector in Ukrainian: previous / month list / next. Replaces the native month input,
 * which renders in the browser's locale and differs between browsers.
 */
export function PeriodPicker({
  value,
  onChange,
  labels,
  className,
}: {
  value: string;
  onChange: (period: string) => void;
  labels: { previous: string; next: string; month: string };
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => onChange(shiftPeriod(value, -1))} aria-label={labels.previous}>
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </Button>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={labels.month}
        className="h-11 min-w-[11rem] rounded-control border border-border bg-surface px-3 text-sm font-medium text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {periodOptions(value).map((period) => (
          <option key={period} value={period}>
            {formatPeriodReadable(period)}
          </option>
        ))}
      </select>
      <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => onChange(shiftPeriod(value, 1))} aria-label={labels.next}>
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  );
}
