import React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { uk } from "@/i18n/uk";

interface QuantityStepperProps {
  value: number;
  onChange: (newValue: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  id?: string;
  className?: string;
}

export function QuantityStepper({
  value,
  onChange,
  disabled = false,
  min = 0,
  max = 99999,
  id,
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
        "inline-flex items-center rounded-control border border-border bg-surface shadow-2xs",
        disabled && "opacity-60 bg-page/50",
        className
      )}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={handleDecrement}
        aria-label={uk.store.decreaseQuantity}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-main hover:bg-page active:scale-90 disabled:opacity-30 disabled:pointer-events-none rounded-l-control transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary z-10"
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
        aria-label={uk.store.quantity}
        className="w-14 text-center font-semibold text-base py-2 bg-transparent text-text-main focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs transition-colors"
      />

      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={handleIncrement}
        aria-label={uk.store.increaseQuantity}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-main hover:bg-page active:scale-90 disabled:opacity-30 disabled:pointer-events-none rounded-r-control transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary z-10"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
