import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue" | "purple" | "slate";
export type BadgeVariant = "subtle" | "outline" | "dot" | "solid";

const TONE_CLASSES: Record<
  BadgeTone,
  { subtle: string; outline: string; solid: string; dot: string }
> = {
  neutral: {
    subtle: "bg-zinc-100 text-zinc-600 border border-zinc-200",
    outline: "bg-white text-zinc-600 border border-zinc-200",
    solid: "bg-zinc-900 text-white border border-zinc-900",
    dot: "bg-zinc-400",
  },
  green: {
    subtle: "bg-[#34c759]/10 text-[#34c759] border border-[#34c759]/20",
    outline: "bg-white text-[#34c759] border border-[#34c759]/30",
    solid: "bg-[#34c759] text-white border border-[#34c759] font-medium",
    dot: "bg-[#34c759]",
  },
  amber: {
    subtle: "bg-[#ff9500]/10 text-[#ff9500] border border-[#ff9500]/20",
    outline: "bg-white text-[#ff9500] border border-[#ff9500]/30",
    solid: "bg-[#ff9500] text-white border border-[#ff9500] font-medium",
    dot: "bg-[#ff9500]",
  },
  red: {
    subtle: "bg-[#ff3b30]/10 text-[#ff3b30] border border-[#ff3b30]/20",
    outline: "bg-white text-[#ff3b30] border border-[#ff3b30]/30",
    solid: "bg-[#ff3b30] text-white border border-[#ff3b30] font-medium",
    dot: "bg-[#ff3b30]",
  },
  blue: {
    subtle: "bg-[#0071e3]/10 text-[#0071e3] border border-[#0071e3]/15",
    outline: "bg-white text-[#0071e3] border border-[#0071e3]/30",
    solid: "bg-[#0071e3] text-white border border-[#0071e3] font-medium",
    dot: "bg-[#0071e3]",
  },
  purple: {
    subtle: "bg-[#af52de]/10 text-[#af52de] border border-[#af52de]/20",
    outline: "bg-white text-[#af52de] border border-[#af52de]/30",
    solid: "bg-[#af52de] text-white border border-[#af52de] font-medium",
    dot: "bg-[#af52de]",
  },
  slate: {
    subtle: "bg-zinc-100 text-zinc-500 border border-zinc-200",
    outline: "bg-white text-zinc-500 border border-zinc-200",
    solid: "bg-zinc-700 text-white border border-zinc-700",
    dot: "bg-zinc-400",
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
        "inline-flex items-center gap-1.5 rounded-full font-medium tracking-tight transition-colors",
        "font-sans antialiased",
        size === "sm" ? "px-2.5 py-0.5 text-[11px] leading-none" : "px-3 py-1 text-xs leading-none",
        toneSet[variant],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", toneSet.dot)} />
      ) : null}
      {children}
    </span>
  );
}
