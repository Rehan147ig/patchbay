import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-700 bg-ink-800/30 px-6 py-16 text-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="mb-2 flex size-14 items-center justify-center rounded-full border border-ink-700 bg-ink-800"
      >
        <svg
          className="size-7 text-ink-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-300">{title}</p>
      {description ? <p className="max-w-md text-xs text-ink-400">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
