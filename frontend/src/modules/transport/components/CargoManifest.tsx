/** What a car carries, per destination in route order: «Підрозділ: Труна Бейка × 1». Nothing is drawn for an empty manifest. */

import { PackageCheck } from "lucide-react";
import { formatCurrency, uk } from "@/modules/transport/i18n";
import type { Manifest } from "@/modules/transport/types";
import { cn } from "@/ui/utils";

const t = uk.transport;

export function CargoManifest({ manifest, className }: { manifest: Manifest | undefined; className?: string }) {
  const entries = (manifest ?? []).filter((e) => e.lines.length > 0);
  if (entries.length === 0) return null;
  // Money is shown only when the lines carry prices (the request item's snapshot); a line without one adds nothing.
  const priced = entries.some((e) => e.lines.some((l) => l.total_cents != null));
  const total = entries.reduce((n, e) => n + e.lines.reduce((m, l) => m + (l.total_cents ?? 0), 0), 0);
  return (
    <section aria-label={t.cargoTitle} className={cn("space-y-1.5 border-l-2 border-primary/40 pl-3", className)}>
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-text-main">
        <PackageCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        {t.cargoTitle}
      </h4>
      <ol className="space-y-1.5">
        {entries.map((e, i) => (
          <li key={`${e.organisation_id}-${i}`} className="text-sm">
            <p className="font-medium text-text-main">
              {entries.length > 1 && <span className="figure mr-1.5 text-text-muted">{i + 1}.</span>}
              {e.organisation_name}
              {e.place && e.place !== e.organisation_name && <span className="font-normal text-text-muted"> · {e.place}</span>}
            </p>
            <ul className="text-text-main">
              {e.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{l.product_name}</span>
                  <span className="figure shrink-0 text-text-muted">
                    {t.cargoQty(l.quantity)}
                    {priced && <span className="ml-3 inline-block min-w-[6.5rem] text-right">{l.total_cents == null ? t.noPrice : formatCurrency(l.total_cents)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {priced && (
        <p className="flex justify-between gap-3 border-t border-border pt-1 text-sm">
          <span className="text-text-muted">{t.requestTotal}</span>
          <span className="figure font-semibold text-text-main">{formatCurrency(total)}</span>
        </p>
      )}
    </section>
  );
}
