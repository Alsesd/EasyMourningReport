import React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/ui/utils";
import { ukPlatform as uk } from "@/platform/i18n";

interface QuantityStepperProps {
  value: number;
  onChange: (newValue: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  id?: string;
  /** What is being counted, e.g. the product and price; names the field and its buttons. */
  label?: string;
  className?: string;
}

export function QuantityStepper({
  value,
  onChange,
  disabled = false,
  min = 0,
  max = 99999,
  id,
  label,
  className,
}: QuantityStepperProps) {
  const [localText, setLocalText] = React.useState<string | null>(null);

  const displayValue = localText !== null ? localText : (value === 0 ? "0" : String(value));

  const handleIncrement = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || value >= max) return;
    setLocalText(null);
    onChange(Math.min(max, value + 1));
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || value <= min) return;
    setLocalText(null);
    onChange(Math.max(min, value - 1));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setLocalText(raw);
    if (raw === "") {
      onChange(0);
      return;
    }
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, parsed)));
    }
  };

  const handleBlur = () => {
    setLocalText(null);
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-control border border-border bg-surface",
        disabled && "opacity-60 bg-surface-raised",
        className
      )}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={handleDecrement}
        aria-label={label ? `${uk.common.decreaseQuantity}: ${label}` : uk.common.decreaseQuantity}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-main hover:bg-surface-raised disabled:opacity-30 disabled:pointer-events-none rounded-l-control transition-colors z-10"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>

      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        value={displayValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onFocus={(e) => {
          setLocalText(value === 0 ? "" : String(value));
          e.target.select();
        }}
        aria-label={label ? `${uk.common.quantity}: ${label}` : uk.common.quantity}
        className="figure w-14 border-x border-border py-2 text-center text-base font-semibold bg-transparent text-text-main focus-visible:outline-none focus-visible:bg-primary-soft transition-colors"
      />

      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={handleIncrement}
        aria-label={label ? `${uk.common.increaseQuantity}: ${label}` : uk.common.increaseQuantity}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-main hover:bg-surface-raised disabled:opacity-30 disabled:pointer-events-none rounded-r-control transition-colors z-10"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
