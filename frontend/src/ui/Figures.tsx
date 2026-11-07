/** Building blocks of the dashboards: a figure, a row of figures, a state line with a status light. */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StateDot } from "@/ui/StateDot";

/** One figure of the dashboard: the number in the book serif, its label beneath, a link if it leads somewhere. */
export function Stat({ label, value, hint, to }: { label: string; value: ReactNode; hint?: string; to?: string }) {
  const body = (
    <>
      <span className="figure block text-[1.875rem] leading-tight text-text-main">{value}</span>
      <span className="mt-0.5 block text-sm text-text-main">{label}</span>
      {hint && <span className="block break-words text-xs text-text-muted">{hint}</span>}
    </>
  );
  const className = "block min-w-0 px-1 py-4 sm:px-5 sm:first:pl-1";
  return to ? (
    <Link to={to} className={`${className} transition-colors hover:bg-surface-raised`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A row of figures separated by thin rules; stacks into ruled rows on phones. */
export function Figures({ children }: { children: ReactNode }) {
  return <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">{children}</div>;
}

/** A state line: what it is, a status light with its word, and a detail. */
export function StateRow({ label, tone, state, detail, to }: { label: string; tone: StateTone; state: string; detail?: string; to?: string }) {
  const body = (
    <>
      <span className="w-full text-sm text-text-muted sm:w-48 sm:shrink-0">{label}</span>
      <span className="flex items-center gap-2 font-medium text-text-main">
        <StateDot tone={tone} />
        {state}
      </span>
      {detail && <span className="min-w-0 break-words text-sm text-text-muted sm:ml-auto sm:text-right">{detail}</span>}
    </>
  );
  const className = "flex flex-wrap items-center gap-x-4 gap-y-0.5 px-1 py-3";
  return to ? (
    <Link to={to} className={`${className} transition-colors hover:bg-surface-raised`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export type StateTone = "ok" | "busy" | "error" | "idle";

