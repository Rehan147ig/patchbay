import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue" | "purple" | "slate";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-ink-700 text-ink-300 ring-ink-600",
  green: "bg-mint-400/10 text-mint-400 ring-mint-400/20",
  amber: "bg-amber-400/10 text-amber-400 ring-amber-400/20",
  red: "bg-red-400/10 text-red-400 ring-red-400/20",
  blue: "bg-accent-500/10 text-accent-400 ring-accent-500/20",
  purple: "bg-violet-400/10 text-violet-400 ring-violet-400/20",
  slate: "bg-ink-700 text-ink-300 ring-ink-600",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
