import type { ReactNode } from "react";
import { cn } from "./cn";

export interface StatusPillProps {
  label: ReactNode;
  tone: "neutral" | "green" | "amber" | "red" | "blue" | "purple";
  className?: string;
}

const DOT: Record<StatusPillProps["tone"], string> = {
  neutral: "bg-gray-400",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  purple: "bg-violet-500",
};

export function StatusPill({ label, tone, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}
