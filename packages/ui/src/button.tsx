import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent-600 text-white hover:bg-accent-500 shadow-[0_0_20px_-6px_rgba(99,102,241,0.6)] hover:shadow-[0_0_28px_-4px_rgba(99,102,241,0.8)] focus-visible:outline-accent-500",
  secondary:
    "bg-ink-700/60 text-gray-200 ring-1 ring-inset ring-ink-600 hover:bg-ink-600 focus-visible:outline-accent-500",
  ghost: "text-ink-300 hover:bg-ink-700 hover:text-gray-100 focus-visible:outline-accent-500",
  danger:
    "bg-red-600 text-white hover:bg-red-500 shadow-[0_0_20px_-6px_rgba(239,68,68,0.5)] focus-visible:outline-red-600",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_20px_-6px_rgba(52,211,153,0.5)] focus-visible:outline-emerald-600",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
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
