"use client";

import { useState, useTransition } from "react";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

interface Props {
  upgradeableTiers: Array<"PRO" | "TEAM">;
  hasStripeCustomer: boolean;
}

/**
 * Billing actions for the settings page: starts a Stripe Checkout session for
 * the selected tier or opens the billing portal, then follows the hosted URL.
 */
export function BillingActions({ upgradeableTiers, hasStripeCustomer }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openBilling(kind: "checkout" | "portal", tier?: "PRO" | "TEAM") {
    setError(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/billing/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: kind === "checkout" ? JSON.stringify({ tier }) : undefined,
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Billing action failed");
        return;
      }
      const body = (await response.json()) as { data: { url: string } };
      window.location.assign(body.data.url);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {upgradeableTiers.map((tier) => (
          <Button
            key={tier}
            size="sm"
            onClick={() => openBilling("checkout", tier)}
            loading={pending}
          >
            Upgrade to {tier}
          </Button>
        ))}
        {hasStripeCustomer ? (
          <Button variant="secondary" size="sm" onClick={() => openBilling("portal")}>
            Manage billing
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
