import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-700/80 bg-gradient-to-b from-ink-850/40 to-ink-900/40 px-6 py-14 text-center backdrop-blur-sm",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-ink-700/60 bg-ink-800/80 text-ink-400 shadow-inner shadow-black/40 [&>svg]:size-5"
      >
        {icon || (
          <svg
            className="size-5 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        )}
      </div>
      <p className="text-sm font-semibold tracking-tight text-gray-200">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-400">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
