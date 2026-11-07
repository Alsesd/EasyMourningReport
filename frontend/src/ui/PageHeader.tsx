import type { ReactNode } from "react";
import { cn } from "@/ui/utils";

/**
 * The top of every page: an optional crumb (where this page sits), the page title set in the book
 * serif, an optional line of context, and the page's actions on the right.
 */
export function PageHeader({
  crumb,
  title,
  meta,
  actions,
  className,
}: {
  crumb?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 pb-6 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {crumb && <div className="mb-1 text-sm text-text-muted">{crumb}</div>}
        <h1 className="text-[1.75rem] leading-tight text-text-main sm:text-[2.125rem]">{title}</h1>
        {meta && <div className="mt-1.5 text-sm text-text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
