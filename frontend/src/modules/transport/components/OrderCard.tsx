/** One order of the day as a ruled row: time, the deceased, delivery and carriers together, the reply and the actions. */

import { History, Pencil, X } from "lucide-react";
import type { TransportOrderDTO } from "@/platform/api/types";
import { uk, formatDayReadable } from "@/modules/transport/i18n";
import { Button } from "@/ui/Button";
import { OrderStatus } from "./StatusPill";

const t = uk.transport;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="break-words text-[15px] text-text-main">{children}</dd>
    </div>
  );
}

export function OrderCard({
  order,
  showOrganisation,
  showDay,
  onEdit,
  onCancel,
  onAction,
  onHistory,
}: {
  order: TransportOrderDTO;
  showOrganisation: boolean;
  showDay: boolean;
  onEdit?: (o: TransportOrderDTO) => void;
  onCancel?: (o: TransportOrderDTO) => void;
  onAction?: (o: TransportOrderDTO, status: string) => void;
  onHistory?: (o: TransportOrderDTO) => void;
}) {
  const d = order.delivery;
  const c = order.carriers;
  return (
    <article className="grid gap-3 border-b border-border px-1 py-4 md:grid-cols-[5.5rem_1fr_16rem]" aria-label={`${order.deceased}, ${order.sort_time}`}>
      <div>
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
        <div className="grid gap-4 sm:grid-cols-2">
          {d && (
            <section aria-label={t.delivery} className="space-y-1.5 border-l-2 border-border pl-3">
              <h4 className="text-sm font-semibold text-text-main">{t.delivery}</h4>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <Detail label={t.car}><span className="figure">{d.car_number}</span></Detail>
                <Detail label={t.time}><span className="figure">{d.time}</span></Detail>
                <div className="col-span-2"><Detail label={t.destination}>{d.destination}</Detail></div>
                {d.stops.length > 0 && <div className="col-span-2"><Detail label={t.stops}>{d.stops.join(" → ")}</Detail></div>}
              </dl>
            </section>
          )}
          {c && (
            <section aria-label={t.carriers} className="space-y-1.5 border-l-2 border-border pl-3">
              <h4 className="text-sm font-semibold text-text-main">{t.carriers}</h4>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <Detail label={t.men}><span className="figure">{c.count}</span></Detail>
                <Detail label={t.time}><span className="figure">{c.time}</span></Detail>
                <div className="col-span-2"><Detail label={t.departure}>{c.from}</Detail></div>
                {c.stops.length > 0 && <div className="col-span-2"><Detail label={t.stops}>{c.stops.join(" → ")}</Detail></div>}
                {c.cemetery_number && <Detail label={t.cemetery}><span className="figure">{c.cemetery_number}</span></Detail>}
              </dl>
            </section>
          )}
        </div>
        {order.notes && <p className="text-sm text-text-muted">{t.notes}: {order.notes}</p>}
      </div>

      <div className="space-y-2 md:text-right">
        <OrderStatus status={order.status} />
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
