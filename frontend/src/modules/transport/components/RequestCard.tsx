/** One product request: who needs what and when, where each item is loaded (car, time), the derived status and the actions. */

import { Ban, Pencil, PackagePlus, X } from "lucide-react";
import { CarFront } from "lucide-react";
import { formatCurrency, formatDayReadable, uk } from "@/modules/transport/i18n";
import type { ProductRequest } from "@/modules/transport/types";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/utils";
import { RequestStatusPill } from "./RequestStatus";

const t = uk.transport;

export function RequestCard({
  request,
  showOrganisation,
  onEdit,
  onCancel,
  onAddToRun,
  onReject,
}: {
  request: ProductRequest;
  showOrganisation: boolean;
  onEdit?: (r: ProductRequest) => void;
  onCancel?: (r: ProductRequest) => void;
  onAddToRun?: (r: ProductRequest) => void;
  onReject?: (r: ProductRequest) => void;
}) {
  const r = request;
  const closed = r.status === "cancelled" || r.status === "rejected";
  const canLoad = (r.status === "submitted" || r.status === "partial") && r.items.some((i) => i.remaining > 0);
  const anyPrice = r.items.some((i) => i.unit_price_cents != null);
  return (
    <article className={cn("space-y-3 border-b border-border px-1 py-4", closed && "opacity-70")} aria-label={`${r.organisation_name}, ${formatDayReadable(r.need_date)}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-main">
            {showOrganisation && <>{r.organisation_name} · </>}
            {t.needBy(formatDayReadable(r.need_date))}
          </h3>
          <p className="text-sm text-text-muted">
            {r.deceased && <>{r.deceased} · </>}
            {t.submittedBy}: {r.submitted_by_name}
          </p>
        </div>
        <RequestStatusPill status={r.status} />
      </div>

      <ul className="divide-y divide-border rounded-control border border-border">
        {r.items.map((i) => (
          <li key={i.id} className="space-y-1 px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="min-w-0 break-words text-[0.9375rem] font-medium text-text-main">{i.product_name}</span>
              <span className="figure text-sm text-text-main">
                {t.loadedOn(i.loaded, i.quantity)}
                {anyPrice && (
                  <span className="ml-3 text-text-muted">
                    {i.unit_price_cents == null ? t.noPrice : formatCurrency(i.total_cents)}
                  </span>
                )}
              </span>
            </div>
            {i.carriers.length === 0 ? (
              <p className="text-sm text-text-muted">{closed ? "" : t.notLoaded}</p>
            ) : (
              <ul className="space-y-0.5">
                {i.carriers.map((c, n) => (
                  <li key={`${c.kind}-${c.id}-${n}`} className="flex items-center gap-1.5 text-sm text-text-muted">
                    <CarFront className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{t.carrierLine(c.quantity, c.kind === "run" ? t.carrierRun : t.carrierOrder, c.car_display, c.time)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5 text-sm text-text-muted">
          {r.car && (
            <p>
              {t.preferredCar}: <span className="figure text-text-main">{r.car.display}</span>
            </p>
          )}
          {r.notes && <p>{t.notes}: {r.notes}</p>}
          {r.reply_note && <p aria-label={t.reply}>{r.reply_note}</p>}
        </div>
        {anyPrice && (
          <p className="text-sm text-text-muted">
            {t.requestTotal}: <span className="figure text-base font-semibold text-text-main">{formatCurrency(r.total_cents)}</span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {onAddToRun && canLoad && (
          <Button type="button" size="sm" onClick={() => onAddToRun(r)}>
            <PackagePlus className="h-4 w-4" aria-hidden="true" />
            {t.addToRun}
          </Button>
        )}
        {onReject && r.status === "submitted" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onReject(r)}>
            <Ban className="h-4 w-4" aria-hidden="true" />
            {t.rejectRequest}
          </Button>
        )}
        {onEdit && r.status === "submitted" && (
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(r)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t.requestEdit}
          </Button>
        )}
        {onCancel && r.status === "submitted" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onCancel(r)}>
            <X className="h-4 w-4" aria-hidden="true" />
            {t.requestCancel}
          </Button>
        )}
      </div>
    </article>
  );
}
