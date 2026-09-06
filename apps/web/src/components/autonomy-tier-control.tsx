"use client";

import { useState } from "react";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";
import type { AutonomyTierChoice } from "./onboarding-wizard";

const TIERS: Array<{ value: AutonomyTierChoice; label: string; hint: string }> = [
  { value: "PLAN_ONLY", label: "Plan only", hint: "No delivery anywhere" },
  { value: "REQUIRE_APPROVAL", label: "Require approval", hint: "Approval before every PR" },
  { value: "ALLOW_DRAFT_PR", label: "Automatic draft PRs", hint: "Validated PRs deliver" },
];

/**
 * Organization delivery autonomy tier control (WP12): current tier with
 * ADMIN-gated switching. Non-admins see the tier and the reason they cannot
 * change it — never a dead button. Enforced worker-side on every PR vector.
 */
export function AutonomyTierControl({
  currentTier,
  explicit,
  isAdmin,
}: {
  currentTier: AutonomyTierChoice;
  explicit: boolean;
  isAdmin: boolean;
}) {
  const [tier, setTier] = useState<AutonomyTierChoice>(currentTier);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await apiFetch("/api/settings/autonomy-tier", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setMessage({ tone: "error", text: body.error?.message ?? "Could not save the tier" });
        return;
      }
      setMessage({ tone: "ok", text: `Tier saved: ${tier}. Applies to the next delivery.` });
    } catch {
      setMessage({ tone: "error", text: "Network error while saving the tier" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[20px] border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-[#1d1d1f]">
          Default delivery autonomy
        </h2>
        {!explicit ? (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
            Recommended default — not yet set explicitly
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Autonomy tier">
        {TIERS.map((option) => (
          <label
            key={option.value}
            title={option.hint}
            className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium ${
              tier === option.value
                ? "border-[#0071e3] bg-[#0071e3]/5 text-[#1d1d1f]"
                : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
            }`}
          >
            <input
              type="radio"
              name="autonomy-tier-policy"
              value={option.value}
              checked={tier === option.value}
              onChange={() => setTier(option.value)}
              className="accent-[#0071e3]"
            />
            {option.label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span title={isAdmin ? "Save the tier" : "Saving the tier requires the ADMIN role"}>
          <Button size="sm" disabled={!isAdmin || saving} onClick={save}>
            {saving ? "Saving…" : "Save tier"}
          </Button>
        </span>
        {!isAdmin ? (
          <span className="text-[11px] text-zinc-500">Saving requires ADMIN.</span>
        ) : null}
        {message ? (
          <span
            role={message.tone === "error" ? "alert" : "status"}
            className="text-[12px] text-zinc-600"
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
