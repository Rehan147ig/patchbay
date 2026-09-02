import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#0071e3] text-white border border-transparent shadow-sm hover:bg-[#0077ed] active:bg-[#0058b0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 focus-visible:ring-offset-0",
  secondary:
    "bg-zinc-900 text-white border border-zinc-900 shadow-sm hover:bg-zinc-800 active:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20",
  outline:
    "bg-white text-zinc-700 border border-zinc-200 shadow-sm hover:bg-zinc-50 hover:text-zinc-900 hover:border-zinc-300 active:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200",
  ghost:
    "bg-transparent text-zinc-600 border border-transparent hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200",
  danger:
    "bg-[#ff3b30] text-white border border-transparent shadow-sm hover:bg-[#ff453a] active:bg-[#d70015] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3b30]/30",
  success:
    "bg-[#34c759] text-white border border-transparent shadow-sm hover:bg-[#30d158] active:bg-[#248a3d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34c759]/30",
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
    xs: icon ? "size-6 p-0 text-[11px] rounded-full" : "h-6 px-2.5 text-[11px] gap-1 rounded-full",
    sm: icon ? "size-7 p-0 text-xs rounded-full" : "h-7 px-3 text-xs gap-1.5 rounded-full",
    md: icon ? "size-9 p-0 text-[13px] rounded-full" : "h-9 px-5 text-[13px] gap-2 rounded-full",
    lg: icon
      ? "size-11 p-0 text-[15px] rounded-full"
      : "h-11 px-6 text-[15px] gap-2.5 rounded-full",
  };

  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium tracking-tight transition-colors duration-150 active:scale-[0.98]",
        "font-sans antialiased",
        "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45",
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
