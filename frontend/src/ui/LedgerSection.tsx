import type { ReactNode } from "react";
import { cn } from "@/ui/utils";

/**
 * A section of the record book: a serif heading with its actions, a heavy ink rule, then the
 * section's ruled rows. Use it instead of a floating card for page content.
 */
export function LedgerSection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-xl text-text-main">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="ledger">{children}</div>
    </section>
  );
}
