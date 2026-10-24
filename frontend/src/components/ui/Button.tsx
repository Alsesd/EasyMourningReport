import React, { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "destructive" | "ghost" | "outline";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
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
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none select-none rounded-control";

    const variantStyles = {
      primary:
        "bg-primary text-primary-fg hover:bg-primary-hover active:opacity-90 shadow-sm",
      secondary:
        "bg-surface text-text-main border border-border hover:bg-page active:bg-border/30 shadow-xs",
      destructive:
        "bg-destructive text-destructive-fg hover:bg-destructive-hover active:opacity-90 shadow-sm",
      ghost:
        "text-text-main hover:bg-page active:bg-border/30",
      outline:
        "border border-border text-text-main bg-transparent hover:bg-surface active:bg-page",
    };

    const sizeStyles = {
      default: "min-h-[44px] px-4 py-2 text-sm",
      sm: "min-h-[40px] px-3 py-1.5 text-xs",
      lg: "min-h-[48px] px-6 py-3 text-base",
      icon: "min-h-[44px] min-w-[44px] p-2",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
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
