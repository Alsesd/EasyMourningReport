/**
 * «Додати до рейсу»: put some of a request's items on a car that already goes to that desk that day: a transport
 * order of the desk, or a planned goods run with a stop there. Quantities are limited by what is still unloaded.
 * The server replaces the whole cargo, so the carrier's present lines are sent back with the new ones.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { manifestLines, mergeLines, runInput } from "@/modules/transport/cargo";
import { transportError } from "@/modules/transport/errors";
import { uk } from "@/modules/transport/i18n";
import { normalizePlate } from "@/modules/transport/plate";
import type { ProductRequest } from "@/modules/transport/types";
import { isOpen } from "@/modules/transport/timing";
import { Button } from "@/ui/Button";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { QuantityStepper } from "@/ui/QuantityStepper";

const t = uk.transport;

type Target = { key: string; label: string; carPlate: string; kind: "order"; id: number } | { key: string; label: string; carPlate: string; kind: "run"; id: number };

export function AddToRunForm({ request, onDone, onNewRun }: { request: ProductRequest; onDone: () => void; onNewRun: (r: ProductRequest) => void }) {
  const board = useQuery({ queryKey: ["transport", "board", request.need_date], queryFn: () => transportApi.board(request.need_date) });
  const targets = useMemo<Target[]>(() => {
    if (!board.data) return [];
    const orders = board.data.orders
      .filter((o) => o.organisation.id === request.organisation_id && isOpen(o.status))
      .map((o): Target => {
        const car = o.delivery?.car_number || o.carriers?.car_number || "";
        return { key: `o${o.id}`, kind: "order", id: o.id, carPlate: normalizePlate(car), label: t.addToRunOrderOption(car, o.sort_time, o.deceased) };
      });
    const runs = board.data.runs
      .filter((r) => r.status === "planned" && r.stops.some((s) => s.organisation_id === request.organisation_id))
      .map((r): Target => ({ key: `r${r.id}`, kind: "run", id: r.id, carPlate: r.car.plate, label: t.addToRunRunOption(r.car.display, r.time) }));
    return [...orders, ...runs];
  }, [board.data, request.organisation_id]);

  const preferred = request.car ? targets.find((x) => x.carPlate === request.car!.plate)?.key : undefined;
  const [picked, setPicked] = useState<string | null>(null);
  const pick = picked ?? preferred ?? targets[0]?.key ?? null;
  const [qty, setQty] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const items = request.items.filter((i) => i.remaining > 0);

  const apply = useMutation({
    mutationFn: async () => {
      const target = targets.find((x) => x.key === pick)!;
      const add = items.map((i) => ({ item_id: i.id, quantity: Math.min(qty[i.id] ?? 0, i.remaining) })).filter((l) => l.quantity > 0);
      if (target.kind === "order") {
        const order = board.data!.orders.find((o) => o.id === target.id)!;
        return transportApi.setCargo(target.id, mergeLines(manifestLines(order.cargo), add));
      }
      const run = board.data!.runs.find((r) => r.id === target.id)!;
      return transportApi.updateRun(target.id, runInput(run, { organisationId: request.organisation_id, lines: add }));
    },
    onSuccess: onDone,
    onError: (err: Error) => setMessage({ text: transportError(err), kind: "err" }),
  });

  if (board.isLoading) return <p className="text-sm text-text-muted">{uk.common.loading}</p>;
  if (board.isError) return <Notice message={{ text: (board.error as Error).message, kind: "err" }} onDismiss={() => undefined} dismissLabel={uk.common.close} />;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!items.some((i) => (qty[i.id] ?? 0) > 0)) return setMessage({ text: t.addToRunNothing, kind: "err" });
        setMessage(null);
        apply.mutate();
      }}
    >
      <p className="text-sm text-text-muted">{t.addToRunHint(request.organisation_name)}</p>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      {targets.length === 0 ? (
        <div className="space-y-3 rounded-control border border-dashed border-border p-4">
          <p className="text-sm text-text-main">{t.addToRunNone}</p>
          <Button type="button" onClick={() => onNewRun(request)}>
            {t.addToRunNewRun}
          </Button>
        </div>
      ) : (
        <>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium text-text-main">{t.addToRunPick}</legend>
            {targets.map((x) => (
              <label key={x.key} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-border px-3 py-2 text-sm text-text-main has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input type="radio" name="target" checked={pick === x.key} onChange={() => setPicked(x.key)} className="h-4 w-4 accent-[var(--primary)]" />
                <span className="min-w-0 break-words">{x.label}</span>
              </label>
            ))}
          </fieldset>
          <ul className="divide-y divide-border border-y border-border">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-words text-[0.9375rem] font-medium text-text-main">{i.product_name}</p>
                  <p className="text-sm text-text-muted">{t.remaining(i.remaining)}</p>
                </div>
                <QuantityStepper label={i.product_name} value={qty[i.id] ?? 0} min={0} max={i.remaining} onChange={(n) => setQty((q) => ({ ...q, [i.id]: n }))} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-[44px]" disabled={apply.isPending}>
              {apply.isPending ? t.saving : t.addToRunApply}
            </Button>
            <Button type="button" variant="outline" onClick={() => onNewRun(request)}>
              {t.addToRunNewRun}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
