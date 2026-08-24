import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-ink-700/60 bg-ink-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.4)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1 border-b border-ink-700/60 px-5 py-4", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-sm font-semibold tracking-tight text-gray-100", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-ink-400", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
  icon?: ReactNode;
}

const TONE_VALUE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "text-white",
  green: "text-mint-400",
  amber: "text-amber-400",
  red: "text-red-400",
};

export function StatCard({ label, value, hint, tone = "neutral", icon }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden px-5 py-4 transition-all duration-300 hover:border-accent-500/30 hover:shadow-[0_0_24px_-8px_rgba(99,102,241,0.25)]">
      {/* Top gradient accent line */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-500/60 to-transparent"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-widest text-ink-400">{label}</p>
        {icon ? (
          <span aria-hidden="true" className="text-ink-500 [&>svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>
      <p className={cn("mt-1.5 text-3xl font-bold tracking-tight tabular-nums", TONE_VALUE[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </Card>
  );
}
