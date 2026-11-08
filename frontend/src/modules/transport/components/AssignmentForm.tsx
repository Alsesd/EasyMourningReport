/** The dispatcher's change of car, time and stops of an open order (the desk's text is not touched). */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { transportApi } from "@/modules/transport/api";
import { transportError } from "@/modules/transport/errors";
import { uk } from "@/modules/transport/i18n";
import type { Car } from "@/modules/transport/types";
import type { TransportOrderDTO } from "@/platform/api/types";
import { Button } from "@/ui/Button";
import { Notice, type NoticeMessage } from "@/ui/Notice";
import { Switch } from "@/ui/Switch";
import { TimeField, isValidTime } from "@/ui/TimeField";
import { CarPicker } from "./CarPicker";
import { carIdOf } from "./OrderForm";
import { StopsEditor } from "./StopsEditor";

const t = uk.transport;

export function AssignmentForm({ order, cars, onDone }: { order: TransportOrderDTO; cars: Car[]; onDone: (saved: TransportOrderDTO) => void }) {
  const d = order.delivery;
  const c = order.carriers;
  const dCar0 = carIdOf(d, cars);
  const cCar0 = carIdOf(c, cars);
  const [dCar, setDCar] = useState<number | null>(dCar0);
  const [dTime, setDTime] = useState(d?.time ?? "");
  const [dStops, setDStops] = useState(d?.stops ?? []);
  const [sameCar, setSameCar] = useState(!!d && !!c && order.same_car);
  const [cCar, setCCar] = useState<number | null>(cCar0);
  const [cTime, setCTime] = useState(c?.time ?? "");
  const [cStops, setCStops] = useState(c?.stops?.length ? c.stops : [""]);
  const [message, setMessage] = useState<NoticeMessage | null>(null);
  const usable = (current: number | null) => cars.filter((x) => x.active || x.id === current);

  const save = useMutation({
    mutationFn: () => {
      const clean = (s: string[]) => s.map((x) => x.trim()).filter(Boolean);
      const carrierCar = d && sameCar ? dCar : cCar;
      return transportApi.assign(order.id, {
        ...(d ? { delivery: { car_id: dCar as number, time: dTime, stops: clean(dStops) } } : {}),
        ...(c ? { carriers: { car_id: carrierCar as number, time: cTime, stops: clean(cStops), same_car: !!d && sameCar } } : {}),
      });
    },
    onSuccess: onDone,
    onError: (err: Error) => setMessage({ text: transportError(err), kind: "err" }),
  });

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if ((d && dCar === null) || (c && !(d && sameCar) && cCar === null) || (c && !d && cCar === null)) return setMessage({ text: t.assignNeedCar, kind: "err" });
        if ((d && !isValidTime(dTime)) || (c && !isValidTime(cTime))) return setMessage({ text: t.timeInvalid, kind: "err" });
        if (c && !cStops.some((s) => s.trim())) return setMessage({ text: t.carriersNeedStop, kind: "err" });
        setMessage(null);
        save.mutate();
      }}
    >
      <p className="text-sm text-text-muted">
        {order.organisation.name} · {order.deceased}
      </p>
      <Notice message={message} onDismiss={() => setMessage(null)} dismissLabel={uk.common.close} />
      {d && (
        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold text-text-main">{t.assignDelivery}</legend>
          <CarPicker id="assign-delivery-car" label={t.carPickerLabel} cars={usable(dCar)} value={dCar} onChange={setDCar} />
          <div>
            <label htmlFor="assign-delivery-time" className="mb-1.5 block text-sm font-medium text-text-main">
              {t.deliveryTime}
            </label>
            <TimeField id="assign-delivery-time" value={dTime} onChange={setDTime} />
          </div>
          <StopsEditor idPrefix="assign-delivery" label={t.stopsOptional} stops={dStops} onChange={setDStops} />
        </fieldset>
      )}
      {c && (
        <fieldset className="space-y-4 border-t border-border pt-5">
          <legend className="mb-2 text-base font-semibold text-text-main">{t.assignCarriers}</legend>
          {d && (
            <div className="flex min-h-[44px] items-center justify-between gap-3">
              <span className="text-sm font-medium text-text-main">{t.sameCar}</span>
              <Switch label={t.sameCar} onText={uk.system.on} offText={uk.system.off} checked={sameCar} onChange={setSameCar} />
            </div>
          )}
          {!(d && sameCar) && <CarPicker id="assign-carriers-car" label={t.carriersCar} cars={usable(cCar)} value={cCar} onChange={setCCar} />}
          <div>
            <label htmlFor="assign-carriers-time" className="mb-1.5 block text-sm font-medium text-text-main">
              {t.carriersTime}
            </label>
            <TimeField id="assign-carriers-time" value={cTime} onChange={setCTime} />
          </div>
          <StopsEditor idPrefix="assign-carriers" label={t.stopsRequired} stops={cStops} onChange={setCStops} />
        </fieldset>
      )}
      <Button type="submit" className="min-h-[44px] w-full sm:w-auto" disabled={save.isPending}>
        {save.isPending ? t.saving : uk.common.save}
      </Button>
    </form>
  );
}
