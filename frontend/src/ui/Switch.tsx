import { cn } from "@/ui/utils";

/**
 * An on/off switch built on a native checkbox (keyboard, forms and screen readers work as usual).
 * The visible state text always matches the state, unlike a fixed "Enabled" label next to a box.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  onText,
  offText,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name, e.g. the row it controls. */
  label: string;
  onText: string;
  offText: string;
}) {
  return (
    <label className={cn("inline-flex min-h-[44px] cursor-pointer items-center gap-2.5", disabled && "cursor-wait opacity-70")}>
      <span className={cn("text-xs font-medium", checked ? "text-primary" : "text-text-muted")} aria-hidden="true">
        {checked ? onText : offText}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 motion-reduce:transition-none",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface",
          checked ? "border-primary bg-primary" : "border-border bg-surface-raised",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-surface transition-transform duration-200 motion-reduce:transition-none",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </label>
  );
}
