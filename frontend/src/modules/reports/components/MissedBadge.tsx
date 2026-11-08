import { AlertTriangle } from "lucide-react";
import { uk } from "@/modules/reports/i18n";
import { cn } from "@/ui/utils";

/**
 * The mark of a day the store did not submit before midnight: «Не надіслано вчасно», or «Надіслано із
 * запізненням» once a late submission exists. The icon repeats the state for people who scan by shape.
 */
export function MissedBadge({ late, className }: { late?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-destructive", className)}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {late ? uk.daily.missedLate : uk.daily.missed}
    </span>
  );
}
