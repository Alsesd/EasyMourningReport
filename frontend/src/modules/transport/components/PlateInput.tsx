/** A car number as typed by a person: formats live to `АА 1234 ВВ`, turns Latin lookalikes into Cyrillic, validates. */

import { useId } from "react";
import { formatPlateInput, plateProblem } from "@/modules/transport/plate";
import { uk } from "@/modules/transport/i18n";
import { Input } from "@/ui/Input";

const t = uk.transport;

export interface PlateValue {
  plate: string;
  nonstandard: boolean;
}

export function PlateInput({
  id,
  value,
  onChange,
  showErrors,
  className,
}: {
  id?: string;
  value: PlateValue;
  onChange: (v: PlateValue) => void;
  /** Show the format error only after the first attempt to save, not while the first letters are typed. */
  showErrors?: boolean;
  className?: string;
}) {
  const auto = useId();
  const inputId = id ?? `${auto}-plate`;
  const hintId = `${inputId}-hint`;
  const problem = plateProblem(value.plate, value.nonstandard);
  const error = showErrors && problem ? (problem === "empty" ? t.plateEmpty : value.nonstandard ? t.plateNonstandardFormat : t.plateFormat) : null;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-text-main">
        {t.carLabel}
      </label>
      <Input
        id={inputId}
        value={value.plate}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={24}
        placeholder="АА 1234 ВВ"
        aria-invalid={error ? true : undefined}
        aria-describedby={hintId}
        className="figure max-w-[14rem] uppercase tracking-wide"
        onChange={(e) => onChange({ ...value, plate: formatPlateInput(e.target.value, value.nonstandard) })}
      />
      <p id={hintId} className={error ? "mt-1 text-sm text-destructive" : "mt-1 text-xs text-text-muted"} role={error ? "alert" : undefined}>
        {error ?? t.plateHint}
      </p>
      <label className="mt-1 inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-text-main">
        <input
          type="checkbox"
          checked={value.nonstandard}
          onChange={(e) => onChange({ plate: formatPlateInput(value.plate, e.target.checked), nonstandard: e.target.checked })}
          className="h-5 w-5 rounded-control border-border accent-[var(--primary)]"
        />
        {t.plateNonstandard}
      </label>
    </div>
  );
}
