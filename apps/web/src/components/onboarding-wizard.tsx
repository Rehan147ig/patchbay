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
 * explorer. Each step is skippable. When the deployment has not configured
 * the GitHub App environment, step 1 says so explicitly instead of failing
 * silently at install time.
 */
export function OnboardingWizard({ appConfigured }: { appConfigured: boolean }) {
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
    <div className="rounded-xl border border-ink-700/60 bg-ink-800/50 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      {/* Progress stepper */}
      <div className="mb-8">
        <ol className="flex items-start justify-between gap-2">
          {STEPS.map((item, index) => (
            <li key={item.number} className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setStep(index)}
                aria-current={index === step ? "step" : undefined}
                className={
                  index < step
                    ? "flex size-8 items-center justify-center rounded-full border border-accent-500 bg-accent-500 text-xs font-bold text-white transition-all"
                    : index === step
                      ? "flex size-8 items-center justify-center rounded-full border border-accent-500 bg-accent-500/10 text-xs font-bold text-accent-400 ring-2 ring-accent-500/30 transition-all"
                      : "flex size-8 items-center justify-center rounded-full border border-ink-700 bg-ink-800 text-xs font-bold text-ink-500 transition-all hover:border-ink-600"
                }
              >
                {index < step ? "✓" : item.number}
              </button>
              <span
                className={
                  index === step
                    ? "text-center text-[11px] font-medium text-white"
                    : "text-center text-[11px] text-ink-500"
                }
              >
                {item.label}
              </span>
            </li>
          ))}
        </ol>
        <div aria-hidden="true" className="mt-2 flex items-center">
          {STEPS.slice(0, -1).map((_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 transition-all duration-500 ${
                i < step ? "bg-accent-500" : "bg-ink-700"
              }`}
            />
          ))}
        </div>
      </div>

      {step === 0 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Install the GitHub App</h2>
          <p className="text-sm leading-relaxed text-ink-400">
            Patch uses a GitHub App to read your repositories, detect upstream SDK changes, and open
            draft pull requests with migration patches. It asks for exactly three permissions —
            Contents (read/write), Pull requests (read/write), and Metadata (read) — and nothing
            else. Draft PRs only: Patch never merges, never writes to your default branch, and
            agents never hold git tokens — credentials stay server-side.
          </p>
          <p className="text-xs text-ink-400">
            Installing takes you to GitHub and back — you will land on{" "}
            <code className="text-ink-400">Settings → GitHub</code> when it is done. Requires a
            configured <code className="text-ink-400">GITHUB_APP_SLUG</code> in this deployment.
          </p>
          {appConfigured ? null : (
            <div
              role="alert"
              className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-300"
            >
              <p className="font-semibold">App not configured.</p>
              <p className="mt-1">
                This deployment is missing the GitHub App environment, so the install link would
                fail. Set <code className="font-mono">GITHUB_APP_SLUG</code> (the App URL slug) plus{" "}
                <code className="font-mono">GITHUB_APP_ID</code>,{" "}
                <code className="font-mono">GITHUB_APP_PRIVATE_KEY</code> (base64 PEM), and{" "}
                <code className="font-mono">GITHUB_APP_WEBHOOK_SECRET</code>, then restart. See{" "}
                <code className="font-mono">docs/self-host.md</code>.
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            {appConfigured ? (
              <a
                href="/api/github/install"
                className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-[0_0_20px_-6px_rgba(99,102,241,0.6)] hover:bg-accent-500"
              >
                Install GitHub App
              </a>
            ) : (
              <span
                aria-disabled="true"
                className="cursor-not-allowed rounded-md bg-ink-700 px-4 py-2 text-sm font-medium text-ink-500"
              >
                Install GitHub App
              </span>
            )}
            <Button variant="secondary" onClick={next}>
              Skip for now
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Connect a repository</h2>
          <p className="text-sm leading-relaxed text-ink-400">
            Register one TypeScript repository that imports a DRAFT_PR-certified SDK —{" "}
            <code className="text-gray-200">openai</code>,{" "}
            <code className="text-gray-200">stripe</code>,{" "}
            <code className="text-gray-200">twilio</code>,{" "}
            <code className="text-gray-200">anthropic</code>, or{" "}
            <code className="text-gray-200">supabase</code> — the fastest path from a release to a
            draft PR. You can connect more later from the Repositories page; your plan determines
            how many active repositories Patch may watch.
          </p>
          <form action={connectRepository} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-ink-400">
                GitHub installation id
                <input
                  name="installationId"
                  type="number"
                  min={1}
                  required
                  placeholder="e.g. 58432107"
                  className="mt-1 block w-full rounded-md border border-ink-600 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
                />
              </label>
              <label className="text-xs text-ink-400">
                Repository (owner/repo)
                <input
                  name="repositoryFullName"
                  required
                  placeholder="acme/billing-service"
                  className="mt-1 block w-full rounded-md border border-ink-600 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
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
            <p className="text-xs text-mint-400">{CONNECT_STATUS.ok}</p>
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
          <h2 className="text-lg font-semibold text-white">From change to draft PR</h2>
          <p className="text-sm leading-relaxed text-ink-400">
            When a tracked vendor releases a breaking change, Watchtower records it under Changes.
            Open the change → Generate plan → approve if the policy gate requires it → Draft PR on
            the remediation. That is the whole path: Patch opens drafts only and never auto-merges;
            agents never hold git tokens; a human reviews and merges.
          </p>
          <p className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-300">
            If this deployment runs{" "}
            <code className="font-mono">SANDBOX_VALIDATION_MODE=github-checks-only</code>,
            validation reports <strong>SKIPPED — never PASSED</strong>. Your CI is the judge of the
            patch.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/changes"
              className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-[0_0_20px_-6px_rgba(99,102,241,0.6)] hover:bg-accent-500"
            >
              Open Changes
            </Link>
            <Link
              href="/releases"
              className="rounded-md border border-ink-600 bg-ink-700/60 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-ink-600"
            >
              Release Explorer
            </Link>
            <Link
              href="/demo"
              className="rounded-md border border-ink-600 bg-ink-700/60 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-ink-600"
            >
              Run the guided demo
            </Link>
            <Link
              href="/overview"
              className="rounded-md border border-ink-600 bg-ink-700/60 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-ink-600"
            >
              Go to overview
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between border-t border-ink-700/60 pt-4">
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
            className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white shadow-[0_0_20px_-6px_rgba(99,102,241,0.6)] hover:bg-accent-500"
          >
            Finish setup
          </Link>
        )}
      </div>
    </div>
  );
}
