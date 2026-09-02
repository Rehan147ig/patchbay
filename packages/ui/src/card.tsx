import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[20px] border border-zinc-200/60 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] backdrop-blur-sm transition-all duration-200",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 border-b border-zinc-200/60 px-6 py-5", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-[15px] font-semibold tracking-tight text-[#1d1d1f]", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-[13px] leading-relaxed tracking-tight text-zinc-500", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-zinc-200/60 bg-zinc-50/50 px-6 py-3.5 text-xs font-medium tracking-wide text-zinc-500",
        className,
      )}
      {...props}
    />
  );
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue" | "purple";
  icon?: ReactNode;
}

const TONE_VALUE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "text-[#1d1d1f]",
  green: "text-[#34c759]",
  amber: "text-[#ff9500]",
  red: "text-[#ff3b30]",
  blue: "text-[#0071e3]",
  purple: "text-[#af52de]",
};

export function StatCard({ label, value, hint, tone = "neutral", icon }: StatCardProps) {
  return (
    <Card className="group relative overflow-hidden rounded-[20px] border-zinc-200 bg-white px-6 py-5 transition-all duration-200 hover:border-zinc-300/80 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
      {/* Subtle top ambient accent line */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#0071e3]/30 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100"
      />
      {/* Watermark background icon */}
      {icon ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-2 -right-2 text-zinc-100/70 transition-transform duration-300 group-hover:scale-105 group-hover:text-[#0071e3]/5 [&>svg]:size-24"
        >
          {icon}
        </div>
      ) : null}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium tracking-tight text-zinc-500">{label}</p>
        {icon ? (
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 shadow-sm transition-colors group-hover:border-[#0071e3]/20 group-hover:bg-[#0071e3]/5 group-hover:text-[#0071e3] [&>svg]:size-4"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "relative z-10 mt-3 text-[20px] font-semibold tracking-tight tabular-nums text-[#1d1d1f]",
          tone !== "neutral" ? TONE_VALUE[tone] : "text-[#1d1d1f]",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="relative z-10 mt-1.5 text-[12px] leading-relaxed text-zinc-500">{hint}</p>
      ) : null}
    </Card>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[20px] border border-zinc-200/60 bg-white p-6 shadow-sm",
        className,
      )}
    >
      <div className="h-3.5 w-1/3 rounded bg-zinc-100" />
      <div className="mt-4 h-8 w-1/2 rounded bg-zinc-100" />
      <div className="mt-2 h-3 w-2/3 rounded bg-zinc-50" />
    </div>
  );
}
