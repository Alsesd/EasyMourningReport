import { forwardRef } from "react";
import { Input, type InputProps } from "@/ui/Input";

/** Keep digits only and insert the colon after the hours: "0930" -> "09:30". Nothing is guessed ("930" stays "93:0" until fixed). */
export function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** True for a complete 24-hour time "ГГ:ХХ". */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Time of day as 24-hour "ГГ:ХХ". A text field with a numeric keypad instead of the native time input,
 * which shows AM/PM and different controls depending on the browser's language.
 */
export const TimeField = forwardRef<HTMLInputElement, Omit<InputProps, "type" | "value" | "onChange"> & { value: string; onChange: (value: string) => void }>(
  ({ value, onChange, ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="ГГ:ХХ"
      maxLength={5}
      value={value}
      onChange={(e) => onChange(maskTime(e.target.value))}
      aria-invalid={value !== "" && !isValidTime(value) ? true : undefined}
      className="figure w-28"
      {...props}
    />
  ),
);
TimeField.displayName = "TimeField";
