/**
 * Create or edit an order: one deceased, one car, a delivery part, a carriers part, or both.
 * The car is asked once. The carrying part goes in the same car by default (from the delivery's end point);
 * its own car and departure appear only when that is switched off.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { transportError } from "@/modules/transport/errors";
import { uk, shiftDay, todayIso } from "@/modules/transport/i18n";
import { normalizePlate } from "@/modules/transport/plate";
import type { Car } from "@/modules/transport/types";
import type { TransportOrderDTO, TransportOrderInputDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { DayPicker } from "@/ui/DayPicker";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { Switch } from "@/ui/Switch";
import { TimeField, isValidTime } from "@/ui/TimeField";
import { CarPicker } from "./CarPicker";
import { StopsEditor } from "./StopsEditor";
import { OrderTiming } from "./StatusPill";

const t = uk.transport;

export interface Draft {
  service_date: string;
  deceased: string;
  notes: string;
  military: boolean;
  /** The order's car (the delivery's, or the carriers' when there is no delivery). */
  carId: number | null;
  /** Old free-text car that is not in the fleet: kept as it was unless another car is chosen. */
  legacyCar: string;
  /** The carriers go in the same car, from the delivery's end point. */
  sameCar: boolean;
  carriersCarId: number | null;
  carriersLegacyCar: string;
  delivery: { on: boolean; departure: string; time: string; destination: string; stops: string[] };
  carriers: { on: boolean; departure: string; count: string; time: string; cemetery_number: string; stops: string[] };
}

const same = (a: string, b: string) => normalizePlate(a) === normalizePlate(b) && a.trim() !== "";
const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function carIdOf(car: { car_id?: number | null; car_number: string } | null | undefined, cars: Car[]): number | null {
  if (!car) return null;
  if (car.car_id) return car.car_id;
  return cars.find((c) => same(c.plate, car.car_number))?.id ?? null;
}

export function draftFrom(day: string, order?: TransportOrderDTO, cars: Car[] = []): Draft {
  const d = order?.delivery ?? null;
  const c = order?.carriers ?? null;
  const dId = carIdOf(d, cars);
  const cId = carIdOf(c, cars);
  const carId = d ? dId : cId;
  const legacyCar = (d ? d.car_number : c?.car_number) ?? "";
  // Same car: both parts have the car and the carrying departs from the delivery's end. Otherwise the parts keep what they had.
  const sameCar = order ? !!d && !!c && (dId !== null ? dId === cId : same(d.car_number, c.car_number) || (!d.car_number && !c.car_number)) && sameText(c.departure, d.destination) : true;
  return {
    service_date: order?.service_date ?? day,
    deceased: order?.deceased ?? "",
    notes: order?.notes ?? "",
    military: order?.military ?? false,
    carId,
    legacyCar: carId === null ? legacyCar : "",
    sameCar,
    carriersCarId: d && c ? cId : null,
    carriersLegacyCar: d && c && cId === null ? c.car_number : "",
    delivery: {
      on: order ? d !== null : true,
      departure: d?.departure ?? "",
      time: d?.time ?? "",
      destination: d?.destination ?? "",
      stops: d?.stops ?? [],
    },
    carriers: {
      on: order ? c !== null : false,
      departure: c?.departure ?? "",
      count: String(c?.count ?? 6),
      time: c?.time ?? "",
      cemetery_number: c?.cemetery_number ?? "",
      stops: c?.stops?.length ? c.stops : [""],
    },
  };
}

/** The first problem a person can fix, or null. The car may stay empty: the dispatcher assigns it. The server checks everything again. */
export function draftProblem(d: Draft): string | null {
  const missing = (...what: string[]) => t.fieldsMissing(what.join(", "));
  if (!d.deceased.trim()) return missing(t.deceasedLabel);
  if (!d.delivery.on && !d.carriers.on) return t.atLeastOne;
  if (d.delivery.on) {
    if (!d.delivery.departure.trim() || !d.delivery.destination.trim() || !isValidTime(d.delivery.time)) {
      return `${t.delivery}. ${missing(t.departure, t.deliveryTime, t.destination)} ${t.timeInvalid}`;
    }
  }
  if (d.carriers.on) {
    const own = !(d.delivery.on && d.sameCar);
    const n = Number(d.carriers.count);
    if ((own && !d.carriers.departure.trim()) || (n !== 4 && n !== 6) || !isValidTime(d.carriers.time) || !d.carriers.cemetery_number.trim()) {
      return `${t.carriers}. ${missing(...(own ? [t.carriersFrom] : []), t.crewLabel, t.carriersTime, t.cemetery)} ${t.timeInvalid}`;
    }
    if (!d.carriers.stops.some((x) => x.trim())) return t.carriersNeedStop;
  }
  return null;
}

export function toInput(d: Draft, cars: Car[] = []): TransportOrderInputDTO {
  const clean = (stops: string[]) => stops.map((s) => s.trim()).filter(Boolean);
  const car = (id: number | null, legacy: string) => {
    const found = id === null ? undefined : cars.find((c) => c.id === id);
    return { car_id: id, car_number: found ? found.display : legacy.trim() };
  };
  const main = car(d.carId, d.legacyCar);
  const carriersCar = d.delivery.on && !d.sameCar ? car(d.carriersCarId, d.carriersLegacyCar) : main;
  const carriersFrom = d.delivery.on && d.sameCar ? d.delivery.destination.trim() : d.carriers.departure.trim();
  return {
    service_date: d.service_date,
    deceased: d.deceased.trim(),
    notes: d.notes.trim(),
    military: d.military,
    delivery: d.delivery.on
      ? { ...main, departure: d.delivery.departure.trim(), time: d.delivery.time, destination: d.delivery.destination.trim(), stops: clean(d.delivery.stops) }
      : null,
    carriers: d.carriers.on
      ? {
          ...carriersCar,
          departure: carriersFrom,
          count: Number(d.carriers.count) as 4 | 6,
          time: d.carriers.time,
          cemetery_number: d.carriers.cemetery_number.trim(),
          stops: clean(d.carriers.stops),
        }
      : null,
  };
}

function Field({ id, label, hint, className, children }: { id: string; label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-text-main">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-border pt-5">
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        <legend className="float-left text-base font-semibold text-text-main">{title}</legend>
        {aside}
      </div>
      {children}
    </fieldset>
  );
}

export function OrderForm({
  day,
  order,
  onSaved,
}: {
  day: string;
  order?: TransportOrderDTO;
  onSaved: (message: string, saved: TransportOrderDTO) => void;
}) {
  const fleet = useQuery({ queryKey: ["transport", "cars"], queryFn: () => transportApi.cars(), staleTime: 60_000 });
  if (fleet.isLoading) return <p className="py-6 text-sm text-text-muted">{uk.common.loading}</p>;
  return <OrderFormBody day={day} order={order} cars={fleet.data?.items ?? []} onSaved={onSaved} />;
}

function OrderFormBody({ day, order, cars, onSaved }: { day: string; order?: TransportOrderDTO; cars: Car[]; onSaved: (message: string, saved: TransportOrderDTO) => void }) {
  const [draft, setDraft] = useState(() => draftFrom(day, order, cars));
  const today = todayIso();
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const save = useMutation({
    mutationFn: (input: TransportOrderInputDTO) => (order ? transportApi.update(order.id, input) : transportApi.create(input)),
    onSuccess: (saved) => onSaved(order ? t.updated : t.created, saved),
    onError: (err: Error) => setMessage({ text: transportError(err), kind: "err" }),
  });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setDelivery = (patch: Partial<Draft["delivery"]>) => setDraft((d) => ({ ...d, delivery: { ...d.delivery, ...patch } }));
  const setCarriers = (patch: Partial<Draft["carriers"]>) => setDraft((d) => ({ ...d, carriers: { ...d.carriers, ...patch } }));
  const carriersOwnCar = draft.delivery.on && draft.carriers.on && !draft.sameCar;

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const problem = draftProblem(draft);
        if (problem) return setMessage({ text: problem, kind: "err" });
        setMessage(null);
        save.mutate(toInput(draft, cars));
      }}
    >
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />

      <section className="space-y-4" aria-label={t.sectionWhen}>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-text-main">{t.serviceDate}</span>
            {/* A new order is not "unclosed" yet: a past day reads as past. */}
            <OrderTiming serviceDate={draft.service_date} status={draft.service_date < today ? "done" : "submitted"} today={today} />
          </div>
          <div role="group" aria-label={t.quickDays} className="flex flex-wrap gap-2">
            {[0, 1, 2].map((n) => {
              const d = shiftDay(today, n);
              return (
                <Button key={n} type="button" size="sm" variant={draft.service_date === d ? "primary" : "outline"} aria-pressed={draft.service_date === d} onClick={() => set({ service_date: d })}>
                  {n === 0 ? t.dayTiming.today : n === 1 ? t.dayTiming.tomorrow : t.dayTiming.dayAfter}
                </Button>
              );
            })}
          </div>
          <DayPicker compact value={draft.service_date} onChange={(v) => set({ service_date: v })} labels={{ previous: t.previousDay, next: t.nextDay, day: t.serviceDate }} />
        </div>
        <Field id="order-deceased" label={t.deceasedLabel}>
          <Input id="order-deceased" value={draft.deceased} maxLength={200} onChange={(e) => set({ deceased: e.target.value })} />
        </Field>
      </section>

      <Section title={t.sectionCar}>
        <div className="space-y-2">
          <CarPicker id="order-car" label={t.carPickerLabel} cars={cars.filter((c) => c.active || c.id === draft.carId)} value={draft.carId} onChange={(carId) => set({ carId, legacyCar: "" })} optional />
          {draft.carId === null && draft.legacyCar ? (
            <p className="text-sm text-attention">{t.carUnknown(draft.legacyCar)}</p>
          ) : (
            <p className="text-xs text-text-muted">{cars.length === 0 ? t.fleetEmptyForm : t.carOptionalHint}</p>
          )}
        </div>
      </Section>

      <Section title={t.sectionDelivery} aside={<Switch label={t.delivery} onText={uk.system.on} offText={uk.system.off} checked={draft.delivery.on} onChange={(on) => setDelivery({ on })} />}>
        {draft.delivery.on && (
          <div className="space-y-4">
            <Field id="delivery-time" label={t.deliveryTime}>
              <TimeField id="delivery-time" value={draft.delivery.time} onChange={(v) => setDelivery({ time: v })} />
            </Field>
            <Field id="delivery-departure" label={t.departure}>
              <Input id="delivery-departure" value={draft.delivery.departure} maxLength={300} onChange={(e) => setDelivery({ departure: e.target.value })} />
            </Field>
            <Field id="delivery-destination" label={t.destination}>
              <Input id="delivery-destination" value={draft.delivery.destination} maxLength={300} onChange={(e) => setDelivery({ destination: e.target.value })} />
            </Field>
            <StopsEditor idPrefix="delivery" label={t.stopsOptional} stops={draft.delivery.stops} onChange={(stops) => setDelivery({ stops })} />
          </div>
        )}
      </Section>

      <Section title={t.sectionCarriers} aside={<Switch label={t.carriers} onText={uk.system.on} offText={uk.system.off} checked={draft.carriers.on} onChange={(on) => setCarriers({ on })} />}>
        {draft.carriers.on && (
          <div className="space-y-4">
            {draft.delivery.on && (
              <div>
                <div className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="text-sm font-medium text-text-main">{t.sameCar}</span>
                  <Switch label={t.sameCar} onText={uk.system.on} offText={uk.system.off} checked={draft.sameCar} onChange={(sameCar) => set({ sameCar })} />
                </div>
                {draft.sameCar && <p className="text-xs text-text-muted">{t.sameCarHint} {t.carriersFromSame(draft.delivery.destination.trim())}.</p>}
              </div>
            )}
            {carriersOwnCar && (
              <>
                <CarPicker
                  id="carriers-car"
                  label={t.carriersCar}
                  cars={cars.filter((c) => c.active || c.id === draft.carriersCarId)}
                  value={draft.carriersCarId}
                  onChange={(carriersCarId) => set({ carriersCarId, carriersLegacyCar: "" })}
                  optional
                />
                {draft.carriersCarId === null && draft.carriersLegacyCar && <p className="-mt-2 text-sm text-attention">{t.carUnknown(draft.carriersLegacyCar)}</p>}
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="carriers-time" label={t.carriersTime}>
                <TimeField id="carriers-time" value={draft.carriers.time} onChange={(v) => setCarriers({ time: v })} />
              </Field>
              <Field id="carriers-count" label={t.crewLabel}>
                <select
                  id="carriers-count"
                  value={draft.carriers.count}
                  onChange={(e) => setCarriers({ count: e.target.value })}
                  className="figure h-11 w-full rounded-control border border-border bg-surface px-3 text-[0.9375rem] text-text-main sm:w-40"
                >
                  <option value="4">{t.crew(4)}</option>
                  <option value="6">{t.crew(6)}</option>
                </select>
              </Field>
            </div>
            {!(draft.delivery.on && draft.sameCar) && (
              <Field id="carriers-departure" label={t.carriersFrom}>
                <Input id="carriers-departure" value={draft.carriers.departure} maxLength={300} onChange={(e) => setCarriers({ departure: e.target.value })} />
              </Field>
            )}
            <StopsEditor idPrefix="carriers" label={t.stopsRequired} stops={draft.carriers.stops} onChange={(stops) => setCarriers({ stops })} />
            <Field id="carriers-cemetery" label={t.cemetery}>
              <Input id="carriers-cemetery" className="figure w-40" value={draft.carriers.cemetery_number} maxLength={50} onChange={(e) => setCarriers({ cemetery_number: e.target.value })} />
            </Field>
          </div>
        )}
      </Section>

      <Section title={t.sectionMore}>
        <div>
          <div className="flex min-h-[44px] items-center justify-between gap-3">
            <span className="text-sm font-medium text-text-main">{t.militaryLabel}</span>
            <Switch label={t.militaryLabel} onText={uk.system.on} offText={uk.system.off} checked={draft.military} onChange={(military) => set({ military })} />
          </div>
          <p className="text-xs text-text-muted">{t.militaryHint}</p>
        </div>
        <Field id="order-notes" label={t.notes}>
          <Input id="order-notes" value={draft.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" className="min-h-[44px] w-full sm:w-auto" disabled={save.isPending}>
          {save.isPending ? t.saving : order ? t.saveChanges : t.save}
        </Button>
      </div>
    </form>
  );
}
