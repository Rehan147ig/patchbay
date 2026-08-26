import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-ink-700/60 bg-ink-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.4)] backdrop-blur-sm transition-all duration-200 hover:border-ink-600/80",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 border-b border-ink-700/60 px-5 py-4", className)}
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
  return <p className={cn("text-xs leading-relaxed text-ink-400", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-t border-ink-700/60 bg-ink-900/30 px-5 py-3 text-xs text-ink-400",
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
  neutral: "text-white",
  green: "text-mint-400",
  amber: "text-amber-400",
  red: "text-red-400",
  blue: "text-accent-400",
  purple: "text-purple-400",
};

export function StatCard({ label, value, hint, tone = "neutral", icon }: StatCardProps) {
  return (
    <Card className="group relative overflow-hidden px-5 py-4 transition-all duration-300 hover:border-accent-500/40 hover:shadow-[0_0_24px_-8px_rgba(99,102,241,0.25)]">
      {/* Top gradient accent line */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-500/60 to-transparent"
      />
      {/* Watermark background icon */}
      {icon ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-2 -right-2 text-ink-700/20 transition-transform duration-300 group-hover:scale-110 group-hover:text-accent-500/10 [&>svg]:size-20"
        >
          {icon}
        </div>
      ) : null}
      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
        {icon ? (
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-lg border border-ink-700/60 bg-ink-800/80 text-ink-400 shadow-sm transition-colors group-hover:border-accent-500/40 group-hover:text-accent-300 [&>svg]:size-3.5"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "relative z-10 mt-2 text-3xl font-bold tracking-tight tabular-nums",
          TONE_VALUE[tone],
        )}
      >
        {value}
      </p>
      {hint ? <p className="relative z-10 mt-1.5 text-xs text-ink-400">{hint}</p> : null}
    </Card>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl border border-ink-700/40 bg-ink-800/30 p-5 shadow-sm",
        className,
      )}
    >
      <div className="h-4 w-1/3 rounded bg-ink-700/50" />
      <div className="mt-4 h-8 w-1/2 rounded bg-ink-700/40" />
      <div className="mt-2 h-3 w-2/3 rounded bg-ink-700/30" />
    </div>
  );
}
