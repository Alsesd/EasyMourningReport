/** «Новий рейс» / «Змінити рейс»: a goods run of one car with a route of desks and, per stop, lines from that desk's open requests. */

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { transportApi } from "@/modules/transport/api";
import { openItems } from "@/modules/transport/cargo";
import { transportError } from "@/modules/transport/errors";
import { uk } from "@/modules/transport/i18n";
import type { Car, ProductRequest, Run } from "@/modules/transport/types";
import { Button } from "@/ui/Button";
import { stickyActions } from "./stickyActions";
import { Combobox } from "@/ui/Combobox";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { TimeField, isValidTime } from "@/ui/TimeField";
import { CarPicker } from "./CarPicker";

const t = uk.transport;

interface LineDraft {
  item_id: number;
  name: string;
  quantity: number;
  /** What can be put on this stop: what is still unloaded plus what this run already carries. */
  max: number;
}
interface StopDraft {
  key: number;
  orgId: number | null;
  place: string;
  lines: LineDraft[];
}

let nextKey = 1;

export function RunEditor({
  day,
  cars,
  openRequests,
  run,
  from,
  onSaved,
}: {
  day: string;
  cars: Car[];
  /** Open requests (anything not fully loaded): the desks and items a stop can take. */
  openRequests: ProductRequest[];
  run?: Run;
  /** A request the run is being made for: its desk is the first stop with all unloaded items, its car preferred. */
  from?: ProductRequest;
  onSaved: (saved: Run) => void;
}) {
  const orgs = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of openRequests) m.set(r.organisation_id, r.organisation_name);
    for (const s of run?.stops ?? []) m.set(s.organisation_id, s.organisation_name);
    if (from) m.set(from.organisation_id, from.organisation_name);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }, [openRequests, run, from]);

  const remainingOf = (itemId: number) => {
    for (const r of openRequests) for (const i of r.items) if (i.id === itemId) return i.remaining;
    return 0;
  };

  const [carId, setCarId] = useState<number | null>(run?.car.id ?? from?.car?.id ?? null);
  const [time, setTime] = useState(run?.time ?? "");
  const [departure, setDeparture] = useState(run?.departure ?? "");
  const [notes, setNotes] = useState(run?.notes ?? "");
  const [stops, setStops] = useState<StopDraft[]>(() => {
    if (run) {
      const used = new Set<number>();
      return [...run.stops]
        .sort((a, b) => a.position - b.position)
        .map((s) => {
          const at = run.manifest.findIndex((e, i) => !used.has(i) && e.organisation_id === s.organisation_id && e.place === s.place);
          if (at >= 0) used.add(at);
          const lines = (at >= 0 ? run.manifest[at].lines : []).map((l) => ({ item_id: l.item_id, name: l.product_name, quantity: l.quantity, max: l.quantity + remainingOf(l.item_id) }));
          return { key: nextKey++, orgId: s.organisation_id, place: s.place, lines };
        });
    }
    if (from) {
      const lines = from.items.filter((i) => i.remaining > 0).map((i) => ({ item_id: i.id, name: i.product_name, quantity: i.remaining, max: i.remaining }));
      return [{ key: nextKey++, orgId: from.organisation_id, place: from.organisation_name, lines }];
    }
    return [{ key: nextKey++, orgId: null, place: "", lines: [] }];
  });
  const [message, setMessage] = useState<NoticeMessage | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        service_date: run?.service_date ?? day,
        car_id: carId as number,
        time,
        departure: departure.trim() || t.runDeparturePlaceholder,
        notes: notes.trim(),
        stops: stops.map((s) => ({
          organisation_id: s.orgId as number,
          place: s.place.trim() || (orgs.find((o) => o.id === s.orgId)?.name ?? ""),
          lines: s.lines.filter((l) => l.quantity > 0).map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
        })),
      };
      return run ? transportApi.updateRun(run.id, input) : transportApi.createRun(input);
    },
    onSuccess: onSaved,
    onError: (err: Error) => setMessage({ text: transportError(err), kind: "err" }),
  });

  const setStop = (key: number, patch: Partial<StopDraft>) => setStops((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) =>
    setStops((ss) => {
      const j = i + d;
      if (j < 0 || j >= ss.length) return ss;
      const next = [...ss];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const itemsFor = (s: StopDraft) =>
    s.orgId === null
      ? []
      : openItems(openRequests, s.orgId)
          .filter(({ item }) => !s.lines.some((l) => l.item_id === item.id))
          .map(({ request, item }) => ({ request, item }));

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (carId === null) return setMessage({ text: t.runNeedCar, kind: "err" });
        if (!isValidTime(time)) return setMessage({ text: t.timeInvalid, kind: "err" });
        if (stops.length === 0 || stops.some((s) => s.orgId === null)) return setMessage({ text: t.runNeedStop, kind: "err" });
        const empty = stops.findIndex((s) => !s.lines.some((l) => l.quantity > 0));
        if (empty >= 0) return setMessage({ text: t.runStopNeedLines(empty + 1), kind: "err" });
        setMessage(null);
        save.mutate();
      }}
    >
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      <section className="space-y-4" aria-label={t.runCarSection}>
        <CarPicker id="run-car" label={t.carPickerLabel} cars={cars.filter((c) => c.active || c.id === carId)} value={carId} onChange={setCarId} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="run-time" className="mb-1.5 block text-sm font-medium text-text-main">
              {t.time}
            </label>
            <TimeField id="run-time" value={time} onChange={setTime} />
          </div>
          <div>
            <label htmlFor="run-departure" className="mb-1.5 block text-sm font-medium text-text-main">
              {t.runDeparture}
            </label>
            <Input id="run-departure" value={departure} maxLength={300} placeholder={t.runDeparturePlaceholder} onChange={(e) => setDeparture(e.target.value)} />
          </div>
        </div>
      </section>

      <fieldset className="space-y-4 border-t border-border pt-5">
        <legend className="float-left mb-3 text-base font-semibold text-text-main">{t.runStops}</legend>
        <ol className="clear-both space-y-5">
          {stops.map((s, i) => {
            const free = itemsFor(s);
            return (
              <li key={s.key} className="space-y-3 rounded-control border border-border p-3">
                <div className="flex items-start gap-2">
                  <span className="figure mt-3 w-5 shrink-0 text-sm font-semibold text-text-muted">{i + 1}.</span>
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`stop-org-${s.key}`} className="mb-1.5 block text-sm font-medium text-text-main">
                        {t.runStopOrg(i + 1)}
                      </label>
                      <select
                        id={`stop-org-${s.key}`}
                        value={s.orgId ?? ""}
                        onChange={(e) => {
                          const orgId = e.target.value ? Number(e.target.value) : null;
                          setStop(s.key, { orgId, place: orgs.find((o) => o.id === orgId)?.name ?? "", lines: [] });
                        }}
                        className="h-11 w-full rounded-control border border-border bg-surface px-3 text-[0.9375rem] text-text-main"
                      >
                        <option value="">{t.pickOrg}</option>
                        {orgs.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`stop-place-${s.key}`} className="mb-1.5 block text-sm font-medium text-text-main">
                        {t.runStopPlace(i + 1)}
                      </label>
                      <Input id={`stop-place-${s.key}`} value={s.place} maxLength={300} onChange={(e) => setStop(s.key, { place: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col sm:flex-row">
                    <Button type="button" variant="ghost" size="icon" aria-label={t.runMoveUp(i + 1)} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t.runMoveDown(i + 1)} disabled={i === stops.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={t.runRemoveStop(i + 1)} disabled={stops.length === 1} onClick={() => setStops((ss) => ss.filter((x) => x.key !== s.key))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {s.lines.length > 0 && (
                  <ul className="divide-y divide-border border-y border-border">
                    {s.lines.map((l) => (
                      <li key={l.item_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                        <span className="min-w-0 break-words text-[0.9375rem] text-text-main">{l.name}</span>
                        <div className="flex items-center gap-2">
                          <QuantityStepper label={`${l.name} (${t.runStopLines(i + 1)})`} value={l.quantity} min={1} max={l.max} onChange={(quantity) => setStop(s.key, { lines: s.lines.map((x) => (x.item_id === l.item_id ? { ...x, quantity } : x)) })} />
                          <Button type="button" variant="ghost" size="icon" aria-label={`${uk.common.delete}: ${l.name}`} onClick={() => setStop(s.key, { lines: s.lines.filter((x) => x.item_id !== l.item_id) })}>
                            <X className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {s.orgId !== null &&
                  (free.length === 0 ? (
                    s.lines.length === 0 && <p className="text-sm text-text-muted">{t.runStopNoItems}</p>
                  ) : (
                    <Combobox
                      label={`${t.runPickItem} (${i + 1})`}
                      items={free}
                      value={null}
                      onChange={(x) => x && setStop(s.key, { lines: [...s.lines, { item_id: x.item.id, name: x.item.product_name, quantity: x.item.remaining, max: x.item.remaining }] })}
                      getKey={(x) => x.item.id}
                      getLabel={(x) => t.runItemLabel(x.item.product_name, x.request.deceased, x.request.need_date.split("-").reverse().slice(0, 2).join("."))}
                      renderMeta={(x) => <span className="figure">{t.remaining(x.item.remaining)}</span>}
                      placeholder={t.runPickItem}
                    />
                  ))}
              </li>
            );
          })}
        </ol>
        <Button type="button" variant="outline" size="sm" onClick={() => setStops((ss) => [...ss, { key: nextKey++, orgId: null, place: "", lines: [] }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t.runAddStop}
        </Button>
      </fieldset>

      <div>
        <label htmlFor="run-notes" className="mb-1.5 block text-sm font-medium text-text-main">
          {t.runNotes}
        </label>
        <Input id="run-notes" value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className={stickyActions}>
        <Button type="submit" className="min-h-[44px] w-full sm:w-auto" disabled={save.isPending}>
          {save.isPending ? t.saving : uk.common.save}
        </Button>
      </div>
    </form>
  );
}
