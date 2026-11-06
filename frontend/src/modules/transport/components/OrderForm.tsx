/** Create or edit an order: one deceased, with a delivery part, a carriers part, or both. */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { uk } from "@/modules/transport/i18n";
import type { TransportOrderDTO, TransportOrderInputDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { DayPicker } from "@/ui/DayPicker";
import { Input } from "@/ui/Input";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { Switch } from "@/ui/Switch";
import { TimeField, isValidTime } from "@/ui/TimeField";
import { StopsEditor } from "./StopsEditor";

const t = uk.transport;

interface Draft {
  service_date: string;
  deceased: string;
  notes: string;
  car_number: string;
  departure: string;
  delivery: { on: boolean; time: string; destination: string; stops: string[] };
  carriers: { on: boolean; count: string; time: string; cemetery_number: string; stops: string[] };
}

export function draftFrom(day: string, order?: TransportOrderDTO): Draft {
  return {
    service_date: order?.service_date ?? day,
    deceased: order?.deceased ?? "",
    notes: order?.notes ?? "",
    car_number: order?.car_number ?? "",
    departure: order?.departure ?? "",
    delivery: {
      on: order ? order.delivery !== null : true,
      time: order?.delivery?.time ?? "",
      destination: order?.delivery?.destination ?? "",
      stops: order?.delivery?.stops ?? [],
    },
    carriers: {
      on: order ? order.carriers !== null : false,
      count: String(order?.carriers?.count ?? 6),
      time: order?.carriers?.time ?? "",
      cemetery_number: order?.carriers?.cemetery_number ?? "",
      stops: order?.carriers?.stops?.length ? order.carriers.stops : [""],
    },
  };
}

/** The first problem a person can fix, or null. The server checks everything again. */
export function draftProblem(d: Draft): string | null {
  if (!d.deceased.trim()) return `${t.deceasedLabel}: ${uk.common.error.toLowerCase()}`;
  if (!d.car_number.trim()) return t.carLabel;
  if (!d.departure.trim()) return t.departureFieldLabel;
  if (!d.delivery.on && !d.carriers.on) return t.atLeastOne;
  if (d.delivery.on && (!d.delivery.destination.trim() || !isValidTime(d.delivery.time))) {
    return `${t.delivery}: ${t.time.toLowerCase()} (${t.timeInvalid.toLowerCase()}), ${t.destinationLabel.toLowerCase()}`;
  }
  const n = Number(d.carriers.count);
  if (d.carriers.on) {
    if ((n !== 4 && n !== 6) || !isValidTime(d.carriers.time) || !d.carriers.cemetery_number.trim()) {
      return `${t.carriers}: ${t.menLabel.toLowerCase()} (4 / 6), ${t.time.toLowerCase()} (${t.timeInvalid.toLowerCase()}), ${t.cemeteryLabel.toLowerCase()}`;
    }
    if (!d.carriers.stops.some((x) => x.trim())) return t.carriersNeedStop;
  }
  return null;
}

export function toInput(d: Draft): TransportOrderInputDTO {
  const clean = (stops: string[]) => stops.map((s) => s.trim()).filter(Boolean);
  return {
    service_date: d.service_date,
    deceased: d.deceased.trim(),
    notes: d.notes.trim(),
    car_number: d.car_number.trim(),
    departure: d.departure.trim(),
    delivery: d.delivery.on
      ? { time: d.delivery.time, destination: d.delivery.destination.trim(), stops: clean(d.delivery.stops) }
      : null,
    carriers: d.carriers.on
      ? {
          count: Number(d.carriers.count) as 4 | 6,
          time: d.carriers.time,
          cemetery_number: d.carriers.cemetery_number.trim(),
          stops: clean(d.carriers.stops),
        }
      : null,
  };
}

export function OrderForm({
  day,
  order,
  onSaved,
}: {
  day: string;
  order?: TransportOrderDTO;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(day, order));
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const save = useMutation({
    mutationFn: (input: TransportOrderInputDTO) => (order ? transportApi.update(order.id, input) : transportApi.create(input)),
    onSuccess: () => onSaved(order ? t.updated : t.created),
    onError: (err: Error) => setMessage({ text: err.message, kind: "err" }),
  });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setDelivery = (patch: Partial<Draft["delivery"]>) => setDraft((d) => ({ ...d, delivery: { ...d.delivery, ...patch } }));
  const setCarriers = (patch: Partial<Draft["carriers"]>) => setDraft((d) => ({ ...d, carriers: { ...d.carriers, ...patch } }));

  const field = (id: string, label: string, control: React.ReactNode) => (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-main">
        {label}
      </label>
      {control}
    </div>
  );

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const problem = draftProblem(draft);
        if (problem) return setMessage({ text: problem, kind: "err" });
        setMessage(null);
        save.mutate(toInput(draft));
      }}
    >
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      {field("order-day", t.serviceDate, <DayPicker compact value={draft.service_date} onChange={(v) => set({ service_date: v })} labels={{ previous: t.previousDay, next: t.nextDay, day: t.serviceDate }} />)}
      {field("order-deceased", t.deceasedLabel, <Input id="order-deceased" value={draft.deceased} maxLength={200} onChange={(e) => set({ deceased: e.target.value })} />)}
      <div className="flex flex-wrap gap-3">
        {field("order-car", t.carLabel, <Input id="order-car" className="w-60" value={draft.car_number} maxLength={30} onChange={(e) => set({ car_number: e.target.value })} />)}
      </div>
      {field("order-departure", t.departureFieldLabel, <Input id="order-departure" value={draft.departure} maxLength={300} onChange={(e) => set({ departure: e.target.value })} />)}

      <fieldset className="space-y-3 border-t border-border pt-4">
        <legend className="sr-only">{t.delivery}</legend>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-text-main">{t.delivery}</h3>
          <Switch label={t.hasDelivery} onText={uk.system.on} offText={uk.system.off} checked={draft.delivery.on} onChange={(on) => setDelivery({ on })} />
        </div>
        {draft.delivery.on && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {field("delivery-time", t.time, <TimeField id="delivery-time" value={draft.delivery.time} onChange={(v) => setDelivery({ time: v })} />)}
            </div>
            {field("delivery-destination", t.destinationLabel, <Input id="delivery-destination" value={draft.delivery.destination} maxLength={300} onChange={(e) => setDelivery({ destination: e.target.value })} />)}
            <StopsEditor idPrefix="delivery" label={t.stopsOptional} stops={draft.delivery.stops} onChange={(stops) => setDelivery({ stops })} />
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3 border-t border-border pt-4">
        <legend className="sr-only">{t.carriers}</legend>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-text-main">{t.carriers}</h3>
          <Switch label={t.hasCarriers} onText={uk.system.on} offText={uk.system.off} checked={draft.carriers.on} onChange={(on) => setCarriers({ on })} />
        </div>
        {draft.carriers.on && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {field(
                "carriers-count",
                t.menLabel,
                <select
                  id="carriers-count"
                  value={draft.carriers.count}
                  onChange={(e) => setCarriers({ count: e.target.value })}
                  className="figure h-11 w-32 rounded-control border border-border bg-surface px-3 text-[15px] text-text-main"
                >
                  <option value="4">{t.crew(4)}</option>
                  <option value="6">{t.crew(6)}</option>
                </select>,
              )}
              {field("carriers-time", t.time, <TimeField id="carriers-time" value={draft.carriers.time} onChange={(v) => setCarriers({ time: v })} />)}
              {field("carriers-cemetery", t.cemeteryLabel, <Input id="carriers-cemetery" className="figure w-32" value={draft.carriers.cemetery_number} maxLength={50} onChange={(e) => setCarriers({ cemetery_number: e.target.value })} />)}
            </div>
            <StopsEditor idPrefix="carriers" label={t.stopsRequired} stops={draft.carriers.stops} onChange={(stops) => setCarriers({ stops })} />
          </div>
        )}
      </fieldset>

      {field("order-notes", t.notes, <Input id="order-notes" value={draft.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />)}

      <Button type="submit" className="min-h-[44px] w-full sm:w-auto" disabled={save.isPending}>
        {save.isPending ? t.saving : order ? t.saveChanges : t.save}
      </Button>
    </form>
  );
}
