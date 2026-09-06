"use client";

import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";

/**
 * Shared data-fetching states (WP12 §D): every data view renders loading,
 * empty (via ui EmptyState at the call site), error with retry, stale
 * background-work indicators, and permission-denied guidance — no raw
 * spinners, no dead ends, no silent failures.
 */
export function LoadingSkeleton({
  rows = 3,
  label = "Loading",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-12 animate-pulse rounded-xl border border-zinc-200/70 bg-zinc-100"
        />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function ErrorState({
  message,
  code,
  retryLabel = "Retry",
}: {
  message: string;
  code?: string;
  retryLabel?: string;
}) {
  const router = useRouter();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
    >
      <p className="text-[13px] font-medium text-red-800">{message}</p>
      {code ? <p className="font-mono text-[11px] text-red-500">Error code: {code}</p> : null}
      <Button size="sm" variant="secondary" onClick={() => router.refresh()}>
        {retryLabel}
      </Button>
    </div>
  );
}

/** Background work is running (scan, sync, validation): data may be stale. */
export function StaleBadge({ label = "Updating…" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-800">
      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
      {label}
    </span>
  );
}

export function DeniedState({
  title = "Permission denied",
  description = "This view requires a higher role. Ask an ADMIN to grant access or perform this action.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3"
    >
      <p className="text-[13px] font-semibold text-zinc-800">{title}</p>
      <p className="text-[12px] leading-relaxed text-zinc-500">{description}</p>
    </div>
  );
}
