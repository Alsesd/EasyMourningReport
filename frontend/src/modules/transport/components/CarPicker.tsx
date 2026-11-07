/** Choose a car of the fleet: a searchable select over its plates (and labels). */

import { useCallback, useMemo } from "react";
import { normalizePlate } from "@/modules/transport/plate";
import { uk } from "@/modules/transport/i18n";
import type { Car } from "@/modules/transport/types";
import { Combobox, type ComboboxHit } from "@/ui/Combobox";

const t = uk.transport;

export function CarPicker({
  id,
  cars,
  value,
  onChange,
  label = t.carLabel,
  optional,
  className,
}: {
  id?: string;
  cars: Car[];
  value: number | null;
  onChange: (id: number | null) => void;
  label?: string;
  /** The desk may leave the car to the dispatcher. */
  optional?: boolean;
  className?: string;
}) {
  const current = useMemo(() => cars.find((c) => c.id === value) ?? null, [cars, value]);
  const search = useCallback(
    (query: string): ComboboxHit<Car>[] => {
      const q = query.trim().toLowerCase();
      const plate = normalizePlate(query);
      return cars
        .filter((c) => !q || c.plate.includes(plate) || c.label.toLowerCase().includes(q))
        .map((item) => ({ item }));
    },
    [cars],
  );
  return (
    <Combobox
      id={id}
      className={className}
      label={label}
      items={cars}
      value={current}
      onChange={(c) => onChange(c ? c.id : null)}
      getKey={(c) => c.id}
      getLabel={(c) => c.display}
      renderMeta={(c) => c.label || undefined}
      search={search}
      placeholder={optional ? t.carOptionalPlaceholder : t.carPlaceholder}
      clearable={optional}
      labels={{ empty: t.carNone }}
    />
  );
}
