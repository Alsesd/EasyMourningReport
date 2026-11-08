import { cn } from "@/ui/utils";
import { ukPlatform as uk } from "@/platform/i18n";

/** A quiet placeholder block; pulses only for people who have not asked for reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("rounded-control bg-surface-raised motion-safe:animate-pulse", className)} />;
}

/** Ruled placeholder rows for a list or table that is still loading, announced once to screen readers. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("ledger", className)}>
      <span className="sr-only">{uk.common.loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center justify-between gap-6 border-b border-border py-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}
