import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-accent-600 to-accent-500 text-white shadow-[0_0_20px_-6px_rgba(99,102,241,0.6)] hover:from-accent-500 hover:to-accent-400 hover:shadow-[0_0_28px_-4px_rgba(99,102,241,0.8)] focus-visible:outline-accent-500 border border-accent-400/30",
  secondary:
    "bg-ink-800 text-gray-200 border border-ink-700/80 hover:bg-ink-700 hover:text-white hover:border-ink-600 focus-visible:outline-accent-500 shadow-sm",
  outline:
    "bg-transparent text-gray-300 border border-ink-700 hover:bg-ink-800/80 hover:text-white hover:border-ink-600 focus-visible:outline-accent-500",
  ghost:
    "bg-transparent text-ink-300 hover:bg-ink-800 hover:text-gray-100 focus-visible:outline-accent-500",
  danger:
    "bg-red-600/90 text-white hover:bg-red-500 shadow-[0_0_20px_-6px_rgba(239,68,68,0.5)] focus-visible:outline-red-600 border border-red-500/30",
  success:
    "bg-emerald-600/90 text-white hover:bg-emerald-500 shadow-[0_0_20px_-6px_rgba(52,211,153,0.5)] focus-visible:outline-emerald-600 border border-emerald-500/30",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "xs" | "sm" | "md" | "lg";
  icon?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    icon = false,
    loading = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const sizeClasses = {
    xs: icon ? "size-6 p-1 text-xs" : "px-2 py-1 text-xs gap-1",
    sm: icon ? "size-8 p-1.5 text-xs" : "px-3 py-1.5 text-xs gap-1.5",
    md: icon ? "size-9 p-2 text-sm" : "px-4 py-2 text-sm gap-2",
    lg: icon ? "size-11 p-2.5 text-base" : "px-5 py-2.5 text-base gap-2.5",
  };

  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:pointer-events-none disabled:opacity-45",
        sizeClasses[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <svg className="size-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      ) : null}
      {children}
    </button>
  );
});
