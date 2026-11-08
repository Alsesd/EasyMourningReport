/**
 * One order of the day as a ruled row: time, the deceased, the car (once), delivery and carriers as a short route,
 * the cargo, the reply and the actions.
 */

import { CarFront, History, Pencil, Route, Shield, Users, X } from "lucide-react";
import type { TransportOrderDTO } from "@/platform/api/types";
import { uk, formatDayReadable } from "@/modules/transport/i18n";
import { Button } from "@/ui/Button";
import { CargoManifest } from "./CargoManifest";
import { OrderStatus, OrderTiming } from "./StatusPill";
import { isOpen } from "@/modules/transport/timing";
import { cn } from "@/ui/utils";

const t = uk.transport;

/** `from → stop → stop → to` as one line; empty parts are skipped. */
function routeText(parts: (string | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.trim() !== "").join(" → ");
}

function CarTag({ number, className }: { number: string; className?: string }) {
  return number ? (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-text-main", className)}>
      <CarFront className="h-4 w-4 text-text-muted" aria-hidden="true" />
      <span className="figure font-medium">{number}</span>
    </span>
  ) : (
    <span className={cn("inline-flex items-center gap-1.5 rounded-control bg-attention-soft px-2 py-0.5 text-sm font-medium text-attention", className)}>
      <CarFront className="h-4 w-4" aria-hidden="true" />
      {t.notAssigned}
    </span>
  );
}

export function OrderCard({
  order,
  showOrganisation,
  showDay,
  today,
  onEdit,
  onCancel,
  onAction,
  onHistory,
  onBearers,
  onAssign,
}: {
  order: TransportOrderDTO;
  showOrganisation: boolean;
  showDay: boolean;
  /** Today's date: the order shows when it is due relative to it. */
  today: string;
  onEdit?: (o: TransportOrderDTO) => void;
  onCancel?: (o: TransportOrderDTO) => void;
  onAction?: (o: TransportOrderDTO, status: string) => void;
  onHistory?: (o: TransportOrderDTO) => void;
  onBearers?: (o: TransportOrderDTO) => void;
  /** Dispatcher: change car, time and stops of an open order. */
  onAssign?: (o: TransportOrderDTO) => void;
}) {
  const d = order.delivery;
  const c = order.carriers;
  const sharedCar = !!d && !!c && order.same_car;
  // After a delivery in the same car, the carrying starts where the delivery ended: its own "from" is not repeated.
  const carriersFollow = sharedCar && c.departure.trim().toLowerCase() === d.destination.trim().toLowerCase();
  const open = isOpen(order.status);
  return (
    <article
      className={cn("grid gap-3 border-b border-border px-1 py-4 md:grid-cols-[5.5rem_1fr_16rem]", !open && "opacity-70")}
      aria-label={`${order.deceased}, ${order.sort_time}`}
    >
      <div className="flex items-baseline gap-3 md:block">
        <p className="figure text-2xl font-semibold text-text-main">{order.sort_time}</p>
        {showDay && <p className="text-xs text-text-muted">{formatDayReadable(order.service_date)}</p>}
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <h3 className="font-serif text-lg font-semibold leading-snug text-text-main">{order.deceased}</h3>
          <p className="text-sm text-text-muted">
            {showOrganisation && <>{order.organisation.name} · </>}
            {t.submittedBy}: {order.submitted_by}
          </p>
        </div>

        {sharedCar && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CarTag number={d.car_number} />
            <span className="text-sm text-text-muted">{t.sameCarCard}</span>
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {d && (
            <section aria-label={t.delivery} className="min-w-0 space-y-1.5 border-l-2 border-border pl-3">
              <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-text-main">
                {t.delivery}
                <span className="figure font-medium text-text-muted">{d.time}</span>
              </h4>
              {!sharedCar && <CarTag number={d.car_number} />}
              <p className="flex items-start gap-1.5 break-words text-[0.9375rem] text-text-main">
                <Route className="mt-1 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                <span>{routeText([d.departure, ...d.stops, d.destination])}</span>
              </p>
            </section>
          )}
          {c && (
            <section aria-label={t.carriers} className="min-w-0 space-y-1.5 border-l-2 border-border pl-3">
              <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-text-main">
                {t.carriers}
                <span className="figure font-medium text-text-muted">{c.time}</span>
                <span className="font-normal text-text-muted">{t.crew(c.count)}</span>
              </h4>
              {!sharedCar && <CarTag number={c.car_number} />}
              <p className="flex items-start gap-1.5 break-words text-[0.9375rem] text-text-main">
                <Route className="mt-1 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                <span>{routeText([carriersFollow ? undefined : c.departure, ...c.stops])}</span>
              </p>
              {c.cemetery_number && (
                <p className="text-sm text-text-muted">
                  {t.cemetery} <span className="figure text-text-main">{c.cemetery_number}</span>
                </p>
              )}
              {c.bearers && c.bearers.length > 0 ? (
                <p className="text-sm">
                  <span className="text-text-muted">{t.bearers}: </span>
                  {c.bearers.join(", ")}
                </p>
              ) : (
                <p className="text-sm text-text-muted">{t.noBearers}</p>
              )}
            </section>
          )}
        </div>
        <CargoManifest manifest={order.cargo} />
        {order.notes && (
          <p className="text-sm text-text-muted">
            {t.notes}: {order.notes}
          </p>
        )}
      </div>

      <div className="space-y-2 md:text-right">
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {order.military && (
            <span className="inline-flex items-center gap-1 rounded-control bg-text-main px-2 py-0.5 text-xs font-semibold text-page">
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              {t.militaryBadge}
            </span>
          )}
          <OrderTiming serviceDate={order.service_date} status={order.status} today={today} />
          <OrderStatus status={order.status} />
        </div>
        <p className="text-sm text-text-muted" aria-label={t.reply}>
          {order.reply_note || (order.status === "submitted" ? t.noReply : "")}
        </p>
        <div className="flex flex-wrap gap-2 md:justify-end">
          {order.can_edit && onEdit && (
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(order)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {uk.common.edit}
            </Button>
          )}
          {order.can_edit && onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onCancel(order)}>
              <X className="h-4 w-4" aria-hidden="true" />
              {t.cancelOrder}
            </Button>
          )}
          {onAction &&
            order.next_statuses.map((s) => (
              <Button key={s} type="button" variant={s === "rejected" ? "ghost" : "secondary"} size="sm" onClick={() => onAction(order, s)}>
                {t.actions[s] ?? s}
              </Button>
            ))}
          {onAssign && open && (
            <Button type="button" variant="outline" size="sm" onClick={() => onAssign(order)}>
              <CarFront className="h-4 w-4" aria-hidden="true" />
              {t.assignAction}
            </Button>
          )}
          {onBearers && c && order.status !== "rejected" && order.status !== "cancelled" && (
            <Button type="button" variant="secondary" size="sm" onClick={() => onBearers(order)}>
              <Users className="h-4 w-4" aria-hidden="true" />
              {t.assignBearers}
            </Button>
          )}
          {onHistory && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onHistory(order)}>
              <History className="h-4 w-4" aria-hidden="true" />
              {t.history}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
