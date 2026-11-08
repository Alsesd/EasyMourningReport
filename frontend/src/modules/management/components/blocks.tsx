/**
 * The three kinds of block a module can put on the management dashboard: tiles (headline figures), a bar series
 * and a ranked list. The renderer knows nothing about any module. Bars are plain CSS in the primary colour, every
 * value is available as text (the table under the chart), never on hover alone.
 */

import { Stat } from "@/ui/Figures";
import { cn } from "@/ui/utils";
import type { DashboardBlockDTO } from "@/platform/api/types";
import { uk } from "@/modules/management/i18n";
import { formatDashValue } from "@/modules/management/format";

type Tile = DashboardBlockDTO["tiles"][number];
type Series = DashboardBlockDTO["series"][number];
type RankedList = DashboardBlockDTO["lists"][number];

export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="border-t border-border first:border-t-0 sm:[&:nth-child(-n+3)]:border-t-0 sm:border-l sm:[&:nth-child(3n+1)]:border-l-0">
          <Stat
            label={t.label}
            value={<span className={cn(t.tone === "alert" && "text-destructive")}>{formatDashValue(t.unit, t.value)}</span>}
            hint={t.hint || undefined}
          />
        </div>
      ))}
    </div>
  );
}

/** Which x labels to print: every point up to 12, otherwise about every fifth, always the first and the last. */
export function labelStep(count: number): number {
  return count <= 12 ? 1 : 5;
}

export function BarSeries({ series }: { series: Series }) {
  const max = Math.max(0, ...series.points.map((p) => p.value));
  const step = labelStep(series.points.length);
  const top = series.points.reduce((best, p, i) => (p.value > series.points[best].value ? i : best), 0);
  const last = series.points.length - 1;
  const hasData = max > 0;
  return (
    <figure className="px-1 py-4">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-sm font-semibold text-text-main">{series.title}</span>
        {series.note && <span className="text-xs text-text-muted">{series.note}</span>}
      </figcaption>
      {!hasData ? (
        <p className="rounded-control border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">{uk.management.noData}</p>
      ) : (
        <>
          <ol className="flex h-40 items-end gap-0.5" aria-label={series.title}>
            {series.points.map((p, i) => {
              const h = p.value > 0 ? Math.max(2, (p.value / max) * 100) : 0;
              const showValue = i === top || i === last;
              return (
                <li
                  key={`${p.label}-${i}`}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`${p.label}: ${formatDashValue(series.unit, p.value)}${p.partial ? ` (${uk.management.partial.toLowerCase()})` : ""}`}
                >
                  {showValue && p.value > 0 && (
                    <span className="figure mb-0.5 block text-center text-[0.625rem] leading-none text-text-main">{formatDashValue(series.unit, p.value)}</span>
                  )}
                  <span
                    aria-hidden="true"
                    style={{ height: `${h}%` }}
                    className={cn("block w-full rounded-t-[4px]", p.value > 0 && (p.partial ? "border border-dashed border-primary bg-primary/30" : "bg-primary"))}
                  />
                </li>
              );
            })}
          </ol>
          <ol className="mt-1 flex gap-0.5" aria-hidden="true">
            {series.points.map((p, i) => (
              <li key={`${p.label}-${i}`} className="figure min-w-0 flex-1 text-center text-[0.625rem] leading-tight text-text-muted">
                {i % step === 0 || i === last ? p.label : ""}
              </li>
            ))}
          </ol>
          <details className="mt-2 text-sm">
            <summary className="min-h-[44px] cursor-pointer py-2.5 text-text-muted">{uk.management.table}</summary>
            <table className="w-full text-left">
              <tbody>
                {series.points.map((p, i) => (
                  <tr key={`${p.label}-${i}`} className="border-b border-border">
                    <th scope="row" className="figure py-1 pr-3 font-normal text-text-muted">
                      {p.label}
                      {p.partial && " *"}
                    </th>
                    <td className="figure py-1 text-right text-text-main">{formatDashValue(series.unit, p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </figure>
  );
}

export function RankedRows({ list }: { list: RankedList }) {
  const max = Math.max(0, ...list.rows.map((r) => r.value));
  return (
    <div className="px-1 py-4">
      <h3 className="mb-2 text-sm font-semibold text-text-main">{list.title}</h3>
      {list.rows.length === 0 ? (
        <p className="rounded-control border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">{uk.management.noData}</p>
      ) : (
        <ol className="divide-y divide-border">
          {list.rows.map((r) => (
            <li key={r.label} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-[0.9375rem] text-text-main">{r.label}</span>
                <span className="figure shrink-0 text-[0.9375rem] font-semibold text-text-main">{formatDashValue(list.unit, r.value)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-raised" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${max > 0 ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
              </div>
              {r.hint && <p className="mt-0.5 text-xs text-text-muted">{r.hint}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
