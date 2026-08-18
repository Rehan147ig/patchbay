"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

/**
 * Feedback verdicts mirror PrOutcomeClassification minus the UNCLASSIFIED
 * sentinel. Kept as literals so the browser bundle never pulls in
 * @patchbay/domain (whose logger imports node:async_hooks). The API route
 * re-validates with the Zod schema.
 */
const CLASSIFICATIONS = [
  "SUCCESS",
  "WRONG_IMPACT",
  "WRONG_PATCH",
  "INSUFFICIENT_TESTS",
  "VALIDATION_FAILURE",
  "MANUAL_EDITS",
  "POLICY_PREFERENCE",
] as const;

type Verdict = (typeof CLASSIFICATIONS)[number];

/**
 * Records human feedback on a merged/closed pull request. Feeds the outcome
 * learning loop: classification, linkage capture, and capability-health
 * re-evaluation.
 */
export function OutcomeFeedbackForm({ pullRequestId }: { pullRequestId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | "">("");

  function submit() {
    if (!verdict) return;
    setStatus(null);
    startTransition(async () => {
      const response = await apiFetch(`/api/pull-requests/${pullRequestId}/outcome`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classification: verdict }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setStatus(body.error?.message ?? "Failed to record feedback");
        return;
      }
      setVerdict("");
      setStatus("Feedback recorded — refreshing…");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Outcome classification"
        value={verdict}
        onChange={(event) => setVerdict(event.target.value as Verdict)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
      >
        <option value="" disabled>
          Classify…
        </option>
        {CLASSIFICATIONS.map((classification) => (
          <option key={classification} value={classification}>
            {classification.replace(/_/g, " ").toLowerCase()}
          </option>
        ))}
      </select>
      <Button
        variant="secondary"
        size="sm"
        onClick={submit}
        loading={pending}
        disabled={verdict === ""}
      >
        Record
      </Button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}
