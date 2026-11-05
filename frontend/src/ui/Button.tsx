import React, { forwardRef } from "react";
import { cn } from "@/ui/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "ghost" | "outline";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
}

const baseStyles =
  "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-50 disabled:pointer-events-none select-none rounded-control";

const variantStyles = {
  primary: "bg-primary text-primary-fg hover:bg-primary-hover",
  secondary: "bg-surface text-text-main border border-border hover:border-text-muted/50",
  destructive: "bg-destructive text-destructive-fg hover:bg-destructive-hover",
  ghost: "text-text-main hover:bg-surface-raised",
  outline: "border border-border bg-surface text-text-main hover:border-text-muted/50",
};

const sizeStyles = {
  default: "min-h-[44px] px-4 text-sm",
  sm: "min-h-[40px] px-3 text-sm",
  lg: "min-h-[48px] px-6 text-base",
  icon: "min-h-[44px] min-w-[44px] p-2",
};

/** The button look for elements that are not buttons, such as a download link. */
export function buttonClass(variant: NonNullable<ButtonProps["variant"]> = "primary", size: NonNullable<ButtonProps["size"]> = "default") {
  return cn(baseStyles, variantStyles[variant], sizeStyles[size]);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "default",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(buttonClass(variant, size), className)}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
