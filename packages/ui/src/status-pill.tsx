import type { ReactNode } from "react";
import { cn } from "./cn";

export interface StatusPillProps {
  label: ReactNode;
  tone: "neutral" | "green" | "amber" | "red" | "blue" | "purple";
  className?: string;
}

const DOT: Record<StatusPillProps["tone"], string> = {
  neutral: "bg-ink-500",
  green: "bg-mint-400",
  amber: "bg-amber-400",
  red: "bg-red-400",
  blue: "bg-accent-500 animate-[pulse_2s_ease-in-out_infinite]",
  purple: "bg-violet-400",
};

export function StatusPill({ label, tone, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-ink-700/60 px-2.5 py-1 text-xs font-medium text-gray-300 ring-1 ring-inset ring-ink-600",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}
