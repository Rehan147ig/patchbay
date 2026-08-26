import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue" | "purple" | "slate";
export type BadgeVariant = "subtle" | "outline" | "dot" | "solid";

const TONE_CLASSES: Record<
  BadgeTone,
  { subtle: string; outline: string; solid: string; dot: string }
> = {
  neutral: {
    subtle: "bg-ink-800 text-ink-300 ring-ink-700/80 border border-ink-700/50",
    outline: "bg-transparent text-ink-300 ring-ink-700 border border-ink-700",
    solid: "bg-ink-700 text-white",
    dot: "bg-ink-400",
  },
  green: {
    subtle: "bg-mint-400/10 text-mint-400 ring-mint-400/20 border border-mint-400/20",
    outline: "bg-transparent text-mint-400 ring-mint-400/40 border border-mint-400/30",
    solid: "bg-mint-500 text-ink-950 font-semibold",
    dot: "bg-mint-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]",
  },
  amber: {
    subtle: "bg-amber-400/10 text-amber-400 ring-amber-400/20 border border-amber-400/20",
    outline: "bg-transparent text-amber-400 ring-amber-400/40 border border-amber-400/30",
    solid: "bg-amber-500 text-ink-950 font-semibold",
    dot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]",
  },
  red: {
    subtle: "bg-red-400/10 text-red-400 ring-red-400/20 border border-red-400/20",
    outline: "bg-transparent text-red-400 ring-red-400/40 border border-red-400/30",
    solid: "bg-red-500 text-white font-semibold",
    dot: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]",
  },
  blue: {
    subtle: "bg-accent-500/10 text-accent-300 ring-accent-500/25 border border-accent-500/20",
    outline: "bg-transparent text-accent-400 ring-accent-500/40 border border-accent-500/30",
    solid: "bg-accent-600 text-white font-semibold",
    dot: "bg-accent-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]",
  },
  purple: {
    subtle: "bg-violet-400/10 text-violet-300 ring-violet-400/25 border border-violet-400/20",
    outline: "bg-transparent text-violet-400 ring-violet-400/40 border border-violet-400/30",
    solid: "bg-violet-600 text-white font-semibold",
    dot: "bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]",
  },
  slate: {
    subtle: "bg-ink-800 text-ink-300 ring-ink-700/80 border border-ink-700/50",
    outline: "bg-transparent text-ink-300 ring-ink-700 border border-ink-700",
    solid: "bg-ink-700 text-white",
    dot: "bg-ink-400",
  },
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
  children: ReactNode;
}

export function Badge({
  tone = "neutral",
  variant = "subtle",
  size = "sm",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  const toneSet = TONE_CLASSES[tone] ?? TONE_CLASSES.neutral;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        toneSet[variant],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full animate-pulse", toneSet.dot)}
        />
      ) : null}
      {children}
    </span>
  );
}
