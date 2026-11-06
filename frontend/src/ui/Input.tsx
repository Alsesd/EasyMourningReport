import React, { forwardRef } from "react";
import { cn } from "@/ui/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex min-h-[44px] w-full rounded-control border border-border bg-surface px-3 py-2 text-[15px] text-text-main placeholder:text-text-muted/70 transition-colors duration-150 hover:border-text-muted/50 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
