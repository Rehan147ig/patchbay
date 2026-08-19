"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

/**
 * Marks a single notification as read, then refreshes the server-rendered
 * list so the unread state and bell badge update.
 */
export function MarkNotificationReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function markRead() {
    setError(null);
    startTransition(async () => {
      const response = await apiFetch("/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Could not mark as read");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={markRead} loading={pending}>
        Mark as read
      </Button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
