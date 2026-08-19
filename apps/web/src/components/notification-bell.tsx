"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 30_000;

interface NotificationsApiResponse {
  data?: { unreadCount?: number };
}

/**
 * Bell for in-app notifications: polls the unread count and links to
 * /notifications. Stays silent (no badge) when the API is unreachable.
 */
export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/notifications", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const body = (await response.json()) as NotificationsApiResponse;
        if (!cancelled) setUnreadCount(body.data?.unreadCount ?? 0);
      } catch {
        // unreachable bell: no badge, no error surface
      }
    };
    void load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={`Notifications (${unreadCount} unread)`}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="size-5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
        />
      </svg>
      {unreadCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
