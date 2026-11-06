/**
 * The day's carrying schedule for printing: who carries, from where, at what time, with which stops and to
 * which cemetery. Only orders with a carriers part that are not rejected or cancelled, ordered by carrying time.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { transportApi } from "@/modules/transport/api";
import { uk, formatDayReadable, todayIso } from "@/modules/transport/i18n";
import type { TransportOrderDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { PageHeader } from "@/ui/PageHeader";

const t = uk.transport;

/** Orders to carry on the day, earliest carrying time first. */
export function carryingOrders(orders: TransportOrderDTO[]): TransportOrderDTO[] {
  return orders
    .filter((o) => o.carriers && o.status !== "rejected" && o.status !== "cancelled")
    .sort((a, b) => (a.carriers!.time === b.carriers!.time ? a.id - b.id : a.carriers!.time < b.carriers!.time ? -1 : 1));
}

export default function TransportSchedulePage() {
  const [params] = useSearchParams();
  const raw = params.get("date");
  const day = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayIso();
  const { data, isLoading } = useQuery({ queryKey: ["transport", "schedule", day], queryFn: () => transportApi.orders({ date: day }) });
  const rows = carryingOrders(data ?? []);

  return (
    <div className="space-y-6">
      <PageHeader
        className="print:pb-2"
        crumb={
          <Link to="/admin/transport" className="print:hidden hover:underline">
            ← {t.backToOrders}
          </Link>
        }
        title={t.scheduleTitle}
        meta={formatDayReadable(day)}
        actions={
          <Button type="button" className="print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t.print}
          </Button>
        }
      />
      {isLoading ? (
        <p className="text-sm text-text-muted">{uk.common.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t.scheduleEmpty}</p>
      ) : (
        <table className="w-full border-collapse text-left text-[15px] print:text-[12pt]">
          <thead>
            <tr className="border-b-2 border-ink text-sm">
              <th className="py-2 pr-3 font-semibold">{t.scheduleTime}</th>
              <th className="py-2 pr-3 font-semibold">{t.deceased}</th>
              <th className="py-2 pr-3 font-semibold">{t.scheduleWhere}</th>
              <th className="py-2 pr-3 font-semibold">{t.scheduleCemetery}</th>
              <th className="py-2 font-semibold">{t.scheduleWho}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const c = o.carriers!;
              const bearers = c.bearers ?? [];
              return (
                <tr key={o.id} className="break-inside-avoid border-b border-border align-top">
                  <td className="figure whitespace-nowrap py-2.5 pr-3 text-lg font-semibold">{c.time}</td>
                  <td className="py-2.5 pr-3">
                    <span className="font-medium">{o.deceased}</span>
                    <span className="block text-sm text-text-muted">{o.organisation.name}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    {o.departure}
                    {c.stops.length > 0 && <span className="block text-sm text-text-muted">→ {c.stops.join(" → ")}</span>}
                    <span className="block text-sm text-text-muted">{t.car}: {o.car_number}</span>
                  </td>
                  <td className="figure py-2.5 pr-3">{c.cemetery_number || "—"}</td>
                  <td className="py-2.5">
                    <span className="block text-sm text-text-muted">{t.crew(c.count)}</span>
                    {bearers.length > 0 ? (
                      <ol className="list-decimal pl-5">
                        {bearers.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ol>
                    ) : (
                      <span className="text-attention">{t.noBearers}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
