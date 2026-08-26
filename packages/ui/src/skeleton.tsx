import { cn } from "./cn";

export function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-ink-800/80", className)} />;
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-800/80 bg-ink-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-ink-800/60">
        <SkeletonLine className="h-4 w-32" />
        <SkeletonLine className="h-4 w-20" />
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 py-2">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} className={cn("h-4 flex-1", c === 0 ? "w-1/4" : "")} />
          ))}
        </div>
      ))}
    </div>
  );
}
