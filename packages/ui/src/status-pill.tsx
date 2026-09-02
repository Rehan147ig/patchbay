import type { ReactNode } from "react";
import { cn } from "./cn";

export interface StatusPillProps {
  label: ReactNode;
  tone: "neutral" | "green" | "amber" | "red" | "blue" | "purple";
  className?: string;
}

const DOT: Record<StatusPillProps["tone"], string> = {
  neutral: "bg-zinc-400",
  green: "bg-[#34c759]",
  amber: "bg-[#ff9500]",
  red: "bg-[#ff3b30]",
  blue: "bg-[#0071e3]",
  purple: "bg-[#af52de]",
};

export function StatusPill({ label, tone, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium tracking-tight text-zinc-600 shadow-sm",
        "font-sans antialiased",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}
