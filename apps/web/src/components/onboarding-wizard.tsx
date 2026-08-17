"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";

const STEPS = [
  { number: 1, label: "Install the GitHub App" },
  { number: 2, label: "Connect repositories" },
  { number: 3, label: "Start watching" },
] as const;

const CONNECT_STATUS = {
  idle: null,
  pending: "Connecting repository…",
  ok: "Connected. Patchbay will scan it for affected usages.",
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
            Patchbay uses a GitHub App to read your repositories, detect releases from changelogs,
            and open draft pull requests with migration patches. Installing takes you to GitHub and
            back — you will land on <code className="text-slate-700">Settings → GitHub</code> when
            it is done.
          </p>
          <p className="text-xs text-slate-500">
            Requires a workspace admin account and a configured{" "}
            <code className="text-slate-600">GITHUB_APP_SLUG</code> in this deployment.
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
          <h2 className="text-lg font-semibold text-slate-900">Connect repositories</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Register one repository now; you can connect more later from the Repositories page. Your
            plan determines how many active repositories Patchbay may watch.
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
          <h2 className="text-lg font-semibold text-slate-900">Start watching releases</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Watchtower tracks npm releases and GitHub changelogs for the vendors Patchbay knows.
            When a breaking change is detected, it is classified and matched against your
            repositories — no action needed from you.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/releases"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Open Release Explorer
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
