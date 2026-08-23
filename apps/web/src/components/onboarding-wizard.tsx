"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

const STEPS = [
  { number: 1, label: "Install the GitHub App" },
  { number: 2, label: "Connect a repository" },
  { number: 3, label: "From change to draft PR" },
] as const;

const CONNECT_STATUS = {
  idle: null,
  pending: "Connecting repository…",
  ok: "Connected. Patch will scan it for affected usages.",
  error: "Failed to connect the repository.",
} as const;

/**
 * First-run onboarding wizard. Guides an admin through installing the GitHub
 * App, registering a repository, and reaching the Watchtower release
 * explorer. Each step is skippable.
 */
export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [connectStatus, setConnectStatus] = useState<keyof typeof CONNECT_STATUS>("idle");
  const [connectMessage, setConnectMessage] = useState<string | null>(null);

  function connectRepository(formData: FormData) {
    setConnectStatus("pending");
    startTransition(async () => {
      const installationId = Number(formData.get("installationId"));
      const repositoryFullName = String(formData.get("repositoryFullName") ?? "");
      const response = await apiFetch("/api/repositories/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ installationId, repositoryFullName }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        setConnectStatus("error");
        setConnectMessage(body.error?.message ?? "Failed to connect the repository");
        return;
      }
      setConnectStatus("ok");
      setConnectMessage(null);
    });
  }

  function next() {
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <ol className="mb-6 flex items-center gap-2 text-xs">
        {STEPS.map((item, index) => (
          <li key={item.number} className="flex items-center gap-2">
            {index > 0 ? <span className="text-slate-300">→</span> : null}
            <button
              type="button"
              onClick={() => setStep(index)}
              aria-current={index === step ? "step" : undefined}
              className={
                index === step
                  ? "rounded-md bg-slate-900 px-2 py-1 font-medium text-white"
                  : "rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
              }
            >
              {item.number}. {item.label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Install the GitHub App</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Patch uses a GitHub App to read your repositories, detect upstream SDK changes, and open
            draft pull requests with migration patches. It asks for exactly three permissions —
            Contents (read/write), Pull requests (read/write), and Metadata (read) — and nothing
            else. Draft PRs only: Patch never merges, never writes to your default branch, and
            agents never hold git tokens — credentials stay server-side.
          </p>
          <p className="text-xs text-slate-500">
            Installing takes you to GitHub and back — you will land on{" "}
            <code className="text-slate-600">Settings → GitHub</code> when it is done. Requires a
            configured <code className="text-slate-600">GITHUB_APP_SLUG</code> in this deployment.
          </p>
          <div className="flex items-center gap-3">
            <a
              href="/api/github/install"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Install GitHub App
            </a>
            <Button variant="secondary" onClick={next}>
              Skip for now
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Connect a repository</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Register one TypeScript repository that imports a certified SDK —{" "}
            <code className="text-slate-700">openai</code>,{" "}
            <code className="text-slate-700">stripe</code>,{" "}
            <code className="text-slate-700">twilio</code>,{" "}
            <code className="text-slate-700">anthropic</code>,{" "}
            <code className="text-slate-700">aws-sdk</code>, or{" "}
            <code className="text-slate-700">supabase</code> — the fastest path from a release to a
            draft PR. You can connect more later from the Repositories page; your plan determines
            how many active repositories Patch may watch.
          </p>
          <form action={connectRepository} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-500">
                GitHub installation id
                <input
                  name="installationId"
                  type="number"
                  min={1}
                  required
                  placeholder="e.g. 58432107"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>
              <label className="text-xs text-slate-500">
                Repository (owner/repo)
                <input
                  name="repositoryFullName"
                  required
                  placeholder="acme/billing-service"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" loading={pending}>
                Connect repository
              </Button>
              <Button variant="secondary" type="button" onClick={next}>
                Skip for now
              </Button>
            </div>
          </form>
          {connectStatus === "ok" ? (
            <p className="text-xs text-green-700">{CONNECT_STATUS.ok}</p>
          ) : null}
          {connectStatus === "error" ? (
            <p role="alert" className="text-xs text-red-600">
              {connectMessage ?? CONNECT_STATUS.error}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">From change to draft PR</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            When a tracked vendor releases a breaking change, Watchtower records it under Changes.
            Open the change → Generate plan → open the remediation → Draft PR. That is the whole
            path: Patch opens drafts only and never auto-merges; a human reviews and merges.
          </p>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            If this deployment runs{" "}
            <code className="font-mono">SANDBOX_VALIDATION_MODE=github-checks-only</code>,
            validation reports <strong>SKIPPED — never PASSED</strong>. Your CI is the judge of the
            patch.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/changes"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Open Changes
            </Link>
            <Link
              href="/releases"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Release Explorer
            </Link>
            <Link
              href="/demo"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Run the guided demo
            </Link>
            <Link
              href="/overview"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Go to overview
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
        {step > 0 ? (
          <Button variant="secondary" size="sm" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <Button size="sm" onClick={next}>
            Continue
          </Button>
        ) : (
          <Link
            href="/overview"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Finish setup
          </Link>
        )}
      </div>
    </div>
  );
}
