"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@patchbay/ui";
import { apiFetch } from "@/lib/client-fetch";
import { ConnectRepositoryForm, type ConnectInstallation } from "./connect-repository-form";

const STEPS = [
  { number: 1, label: "Install the GitHub App" },
  { number: 2, label: "Select the fleet" },
  { number: 3, label: "Watch sources" },
  { number: 4, label: "Shadow scan" },
  { number: 5, label: "First case" },
  { number: 6, label: "Choose policy" },
] as const;

export interface WizardRepository {
  id: string;
  fullName: string;
  status: string;
  defaultBranch: string;
}

export interface CatalogVendor {
  slug: string;
  name: string;
  watched: boolean;
}

export interface FirstCasePreview {
  id: string;
  status: string;
  repositoryName: string;
  releaseVersion: string | null;
  packageName: string | null;
  vendorSlug: string | null;
  usages: Array<{ filePath: string; symbol: string; riskTags: string[] }>;
}

export type AutonomyTierChoice = "PLAN_ONLY" | "REQUIRE_APPROVAL" | "ALLOW_DRAFT_PR";

interface InstallationRepo {
  fullName: string;
  defaultBranch: string;
  externalId: string;
  isPrivate: boolean;
}

/**
 * Six-step continuous-maintenance onboarding (WP12 §A). Every step performs
 * real work against real APIs (install → fleet toggle → source watch →
 * shadow scan with live polling → case preview → persisted policy tier) and
 * every step is skippable to the dashboard page that owns the deferred work.
 */
export function OnboardingWizard({
  appConfigured,
  installations = [],
  repositories,
  catalogVendors,
  firstCase,
  currentTier,
  isAdmin,
}: {
  appConfigured: boolean;
  installations?: ConnectInstallation[];
  repositories: WizardRepository[];
  catalogVendors: CatalogVendor[];
  firstCase: FirstCasePreview | null;
  currentTier: AutonomyTierChoice | null;
  isAdmin: boolean;
}) {
  const [step, setStep] = useState(0);
  function next() {
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  return (
    <div className="rounded-xl border border-ink-700/60 bg-ink-800/50 p-6 shadow-[0_1px_3px_rgba(0,0,0,0.4)] backdrop-blur-xl">
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

      {step === 0 ? <StepInstall appConfigured={appConfigured} onNext={next} /> : null}
      {step === 1 ? <StepFleet installations={installations} initial={repositories} /> : null}
      {step === 2 ? <StepSources catalogVendors={catalogVendors} /> : null}
      {step === 3 ? <StepShadowScan repositories={repositories} /> : null}
      {step === 4 ? <StepFirstCase firstCase={firstCase} /> : null}
      {step === 5 ? <StepPolicy currentTier={currentTier} isAdmin={isAdmin} /> : null}

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
            Open Maintenance Overview
          </Link>
        )}
      </div>
    </div>
  );
}

function StepInstall({ appConfigured, onNext }: { appConfigured: boolean; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Install the GitHub App</h2>
      <p className="text-sm leading-relaxed text-ink-400">
        Patch uses a GitHub App to read your repositories, detect upstream SDK changes, and open
        draft pull requests with migration patches. It asks for exactly three permissions — Contents
        (read/write), Pull requests (read/write), and Metadata (read) — and nothing else. Draft PRs
        only: Patch never merges, never writes to your default branch, and agents never hold git
        tokens — credentials stay server-side.
      </p>
      {appConfigured ? null : (
        <div
          role="alert"
          className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-300"
        >
          <p className="font-semibold">App not configured.</p>
          <p className="mt-1">
            This deployment is missing the GitHub App environment, so the install link would fail.
            Set <code className="font-mono">GITHUB_APP_SLUG</code> (the App URL slug) plus{" "}
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
            title="Requires GITHUB_APP_SLUG in this deployment"
            className="cursor-not-allowed rounded-md bg-ink-700 px-4 py-2 text-sm font-medium text-ink-500"
          >
            Install GitHub App
          </span>
        )}
        <Button variant="secondary" onClick={onNext}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function StepFleet({
  installations,
  initial,
}: {
  installations: ConnectInstallation[];
  initial: WizardRepository[];
}) {
  const [installationId, setInstallationId] = useState<number | null>(
    installations[0]?.installationId ?? null,
  );
  const [available, setAvailable] = useState<InstallationRepo[] | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [repos, setRepos] = useState<WizardRepository[]>(initial);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function loadAvailable(id: number) {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/github/installations/${id}/repositories`, {
        method: "GET",
      });
      const body = (await response.json()) as {
        data?: { repositories: InstallationRepo[]; connectedFullNames: string[] };
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Could not list installation repositories");
        setAvailable(null);
        return;
      }
      setAvailable(body.data?.repositories ?? []);
      setConnected(body.data?.connectedFullNames ?? []);
    } catch {
      setError("Network error while listing repositories");
      setAvailable(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (installationId !== null) void loadAvailable(installationId);
  }, [installationId]);

  async function toggleMonitor(repo: WizardRepository) {
    const target = repo.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE";
    setBusy(repo.id);
    setError(null);
    setOk(null);
    try {
      const response = await apiFetch(`/api/repositories/${repo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "Update failed");
        return;
      }
      setRepos((current) => current.map((r) => (r.id === repo.id ? { ...r, status: target } : r)));
      setOk(`${repo.fullName} is now ${target === "ACTIVE" ? "monitored" : "archived"}.`);
    } catch {
      setError("Network error while updating repository");
    } finally {
      setBusy(null);
    }
  }

  if (installations.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Select the fleet</h2>
        <p className="text-sm text-ink-400">
          No GitHub App installations yet — install the App (step 1) or connect a repository
          directly below. Connected repositories appear here for monitoring toggles.
        </p>
        <ConnectRepositoryForm installations={installations} />
        <FleetTable repos={repos} busy={busy} onToggle={toggleMonitor} />
        <StepNotice error={error} ok={ok} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Select the fleet</h2>
      <p className="text-sm leading-relaxed text-ink-400">
        Toggle which repositories Patchbay monitors. Monitored repos are scanned and swept; archived
        repos are ignored until restored. Changes persist immediately.
      </p>
      <label className="block text-xs text-ink-400">
        Installation
        <select
          value={installationId ?? ""}
          onChange={(event) => setInstallationId(Number(event.target.value))}
          className="mt-1 block w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-gray-200"
        >
          {installations.map((inst) => (
            <option key={inst.installationId} value={inst.installationId}>
              {inst.accountLogin} ({inst.accountType})
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p className="text-xs text-ink-400" role="status">
          Loading installation repositories…
        </p>
      ) : null}
      {available !== null && available.length > 0 ? (
        <ul className="space-y-2">
          {available.map((repo) => {
            const known = repos.find((r) => r.fullName === repo.fullName);
            const isConnected = known !== undefined || connected.includes(repo.fullName);
            return (
              <li
                key={repo.fullName}
                className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-800 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">{repo.fullName}</p>
                  <p className="text-[11px] text-ink-400">
                    {repo.isPrivate ? "private" : "public"} · {repo.defaultBranch}
                    {known ? ` · ${known.status === "ACTIVE" ? "monitored" : "archived"}` : ""}
                  </p>
                </div>
                {known ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === known.id}
                    onClick={() => toggleMonitor(known)}
                  >
                    {known.status === "ACTIVE" ? "Archive" : "Monitor"}
                  </Button>
                ) : (
                  <span
                    className="text-[11px] text-ink-400"
                    title="Connect this repository from step 1 or the Repositories page"
                  >
                    {isConnected ? "Connected" : "Not connected"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {available !== null && available.length === 0 && !loading ? (
        <p className="text-xs text-ink-400">
          No repositories visible to this installation. Check the App installation&apos;s repository
          access on GitHub.
        </p>
      ) : null}
      <FleetTable repos={repos} busy={busy} onToggle={toggleMonitor} />
      <StepNotice error={error} ok={ok} />
    </div>
  );
}

function FleetTable({
  repos,
  busy,
  onToggle,
}: {
  repos: WizardRepository[];
  busy: string | null;
  onToggle: (repo: WizardRepository) => void;
}) {
  if (repos.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-ink-400">
        No connected repositories yet. Connect one above — it will appear here with a monitoring
        toggle.
      </p>
    );
  }
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-400">
        Connected fleet ({repos.length})
      </h3>
      <ul className="space-y-2">
        {repos.map((repo) => (
          <li
            key={repo.id}
            className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-800 px-3 py-2"
          >
            <p className="min-w-0 flex-1 truncate text-sm text-gray-200">{repo.fullName}</p>
            <span className="text-[11px] text-ink-400">
              {repo.status === "ACTIVE" ? "monitored" : "archived"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy === repo.id}
              onClick={() => onToggle(repo)}
            >
              {repo.status === "ACTIVE" ? "Archive" : "Monitor"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepSources({ catalogVendors }: { catalogVendors: CatalogVendor[] }) {
  const [watched, setWatched] = useState<string[]>(
    catalogVendors.filter((v) => v.watched).map((v) => v.slug),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function watch(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      const response = await apiFetch("/api/contracts/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorSlug: slug, kind: "SDK", name: `${slug}-sdk` }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? `Could not watch ${slug}`);
        return;
      }
      setWatched((current) => (current.includes(slug) ? current : [...current, slug]));
    } catch {
      setError("Network error while watching source");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Watch contract sources</h2>
      <p className="text-sm leading-relaxed text-ink-400">
        Watched vendors feed change detection: registry polls on these SDKs become the contract
        changes your cases remediate. Watching is idempotent — re-selecting never duplicates.
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {catalogVendors.map((vendor) => {
          const isWatched = watched.includes(vendor.slug);
          return (
            <li
              key={vendor.slug}
              className="flex items-center gap-3 rounded-md border border-ink-700 bg-ink-800 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-200">{vendor.name}</p>
                <p className="font-mono text-[11px] text-ink-400">
                  {vendor.slug} · SDK · DRAFT_PR-certified
                </p>
              </div>
              {isWatched ? (
                <span className="text-xs font-medium text-emerald-400">Watching ✓</span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === vendor.slug}
                  onClick={() => watch(vendor.slug)}
                >
                  {busy === vendor.slug ? "…" : "Watch"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {catalogVendors.length === 0 ? (
        <p className="text-xs text-ink-400">
          No certified vendors in this deployment yet — sources can be registered later from the
          Sources page.
        </p>
      ) : null}
      <StepNotice error={error} ok={null} />
    </div>
  );
}

function StepShadowScan({ repositories }: { repositories: WizardRepository[] }) {
  const monitored = repositories.filter((r) => r.status === "ACTIVE");
  const [repoId, setRepoId] = useState<string>(monitored[0]?.id ?? "");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  async function start() {
    if (!repoId) return;
    setPhase("running");
    setDetail(null);
    setElapsed(0);
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    try {
      const trigger = await apiFetch(`/api/repositories/${repoId}/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const triggered = (await trigger.json()) as { error?: { message?: string } };
      if (!trigger.ok) {
        setPhase("failed");
        setDetail(triggered.error?.message ?? "Scan failed to start");
        return;
      }
      // Poll the latest scan until it leaves QUEUED/RUNNING (40 × 3s cap).
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const check = await apiFetch(`/api/repositories/${repoId}/scan`, { method: "GET" });
        const body = (await check.json()) as {
          data?: { scan?: { status?: string } };
          error?: { message?: string };
        };
        const status = body.data?.scan?.status;
        if (status === "COMPLETED") {
          setPhase("done");
          setDetail("Shadow scan complete: usage inventory refreshed. No PRs were created.");
          return;
        }
        if (status === "FAILED") {
          setPhase("failed");
          setDetail("Shadow scan failed in the worker — check Operations for the dead letter.");
          return;
        }
      }
      setPhase("failed");
      setDetail("Scan is taking unusually long — follow it from Operations, then continue.");
    } catch {
      setPhase("failed");
      setDetail("Network error while running the shadow scan");
    } finally {
      clearInterval(timer);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Trigger the shadow scan</h2>
      <p className="text-sm leading-relaxed text-ink-400">
        Read-only analysis: Patch indexes dependencies and builds the usage graph without creating
        plans or PRs. Watch it run live, then continue.
      </p>
      {monitored.length === 0 ? (
        <p
          role="alert"
          className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-300"
        >
          No monitored repositories — go back one step and monitor at least one, or skip and scan
          later from the Repositories page.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-ink-400">
            Repository
            <select
              value={repoId}
              onChange={(event) => setRepoId(event.target.value)}
              disabled={phase === "running"}
              className="ml-2 rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-gray-200"
            >
              {monitored.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={start} loading={phase === "running"} disabled={phase === "running"}>
            {phase === "running" ? `Scanning… ${elapsed}s` : "Start shadow scan"}
          </Button>
        </div>
      )}
      {phase === "running" ? (
        <p role="status" className="text-xs text-ink-400">
          Scan running ({elapsed}s) — indexing dependencies and usages. This usually takes under a
          minute.
        </p>
      ) : null}
      {detail ? (
        <p role={phase === "failed" ? "alert" : "status"} className="text-xs text-ink-300">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function StepFirstCase({ firstCase }: { firstCase: FirstCasePreview | null }) {
  if (!firstCase) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">First maintenance case</h2>
        <p className="text-sm text-ink-400">
          No open cases yet — new SDK releases and contract changes will open them automatically.
          Here is exactly what one looks like when it lands:
        </p>
        <div className="rounded-md border border-dashed border-ink-600 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-400">
            Illustrative example — not your data
          </p>
          <p className="mt-2 text-sm font-medium text-gray-200">
            openai 3.x → 4.x: `createChatCompletion` removed
          </p>
          <ul className="mt-2 space-y-1 text-xs text-ink-300">
            <li>
              <code className="font-mono">src/chat/service.ts · createChatCompletion</code>{" "}
              <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">
                AUTHORIZATION
              </span>
            </li>
            <li>
              <code className="font-mono">src/billing/invoices.ts · openai.create</code>{" "}
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                SECRETS
              </span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-ink-400">
            Open the case → Assess blast radius → Plan → sandbox Validate → Approve → Draft PR with
            a §7.4 evidence block. Humans always merge.
          </p>
        </div>
        <Link href="/cases" className="text-sm text-accent-400 hover:underline">
          Open the case queue →
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">First maintenance case</h2>
      <div className="rounded-md border border-ink-600 bg-ink-800 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-gray-200">
            {firstCase.packageName ?? firstCase.vendorSlug ?? "Upstream change"} →{" "}
            {firstCase.repositoryName}
          </p>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            {firstCase.status}
          </span>
        </div>
        {firstCase.releaseVersion ? (
          <p className="mt-1 text-xs text-ink-400">Release {firstCase.releaseVersion}</p>
        ) : null}
        {firstCase.usages.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {firstCase.usages.map((usage) => (
              <li key={`${usage.filePath}:${usage.symbol}`} className="text-xs text-ink-300">
                <code className="font-mono">
                  {usage.filePath} · {usage.symbol}
                </code>{" "}
                {usage.riskTags.map((tag) => (
                  <span
                    key={tag}
                    className="ml-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300"
                  >
                    {tag}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-400">
            Blast radius is still being assessed — open the case for the live view.
          </p>
        )}
        <Link
          href={`/cases/${firstCase.id}`}
          className="mt-3 inline-block text-sm text-accent-400 hover:underline"
        >
          Open this case →
        </Link>
      </div>
    </div>
  );
}

const TIERS: Array<{
  value: AutonomyTierChoice;
  title: string;
  badge?: string;
  description: string;
}> = [
  {
    value: "PLAN_ONLY",
    title: "Plan only",
    description:
      "Safest: Patch generates plans and blast-radius previews. PR delivery is refused everywhere — nothing can ship without a tier change.",
  },
  {
    value: "REQUIRE_APPROVAL",
    title: "Require approval",
    badge: "Recommended",
    description:
      "Plans and sandbox validation run automatically; every draft PR waits for a covering human approval. Quorum rules still apply to sensitive tags.",
  },
  {
    value: "ALLOW_DRAFT_PR",
    title: "Automatic draft PRs",
    description:
      "Validated draft PRs with §7.4 evidence blocks deliver automatically under existing certification, gate, and policy checks. Humans still merge.",
  },
];

function StepPolicy({
  currentTier,
  isAdmin,
}: {
  currentTier: AutonomyTierChoice | null;
  isAdmin: boolean;
}) {
  const [tier, setTier] = useState<AutonomyTierChoice>(currentTier ?? "REQUIRE_APPROVAL");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(currentTier !== null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!isAdmin) {
      setError(
        "Choosing the organization tier requires ADMIN — ask an admin, or finish and set it from Policies later.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch("/api/settings/autonomy-tier", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "Could not save the tier");
        return;
      }
      setSaved(true);
    } catch {
      setError("Network error while saving the tier");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Choose the organization policy</h2>
      <p className="text-sm leading-relaxed text-ink-400">
        The default delivery autonomy for this organization. Enforced in the PR worker on every
        vector — changing it later takes effect on the next delivery.
        {currentTier ? ` Currently saved: ${currentTier}.` : ""}
      </p>
      <div role="radiogroup" aria-label="Autonomy tier" className="space-y-2">
        {TIERS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              tier === option.value
                ? "border-accent-500 bg-accent-500/10"
                : "border-ink-700 bg-ink-800 hover:border-ink-600"
            }`}
          >
            <input
              type="radio"
              name="autonomy-tier"
              value={option.value}
              checked={tier === option.value}
              onChange={() => {
                setTier(option.value);
                setSaved(false);
              }}
              className="mt-1"
            />
            <span>
              <span className="flex items-center gap-2 text-sm font-medium text-gray-200">
                {option.title}
                {option.badge ? (
                  <span className="rounded-full bg-accent-500/20 px-2 py-0.5 text-[10px] font-medium text-accent-300">
                    {option.badge}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} loading={saving} disabled={saved && tier === currentTier}>
          {saved && tier === currentTier ? "Saved ✓" : "Save policy"}
        </Button>
        {!isAdmin ? (
          <span
            className="text-[11px] text-ink-400"
            title="Saving the tier requires the ADMIN role"
          >
            ADMIN required to save
          </span>
        ) : null}
      </div>
      <StepNotice
        error={error}
        ok={saved ? "Policy saved — it applies to the next delivery." : null}
      />
      <p className="text-xs text-ink-400">
        Next: the Maintenance Overview — open cases, fleet health, and delivery activity.{" "}
        <Link href="/overview" className="text-accent-400 hover:underline">
          Skip to overview →
        </Link>
      </p>
    </div>
  );
}

function StepNotice({ error, ok }: { error: string | null; ok: string | null }) {
  if (error) {
    return (
      <p role="alert" className="text-xs text-red-500">
        {error}
      </p>
    );
  }
  if (ok) {
    return <p className="text-xs text-emerald-400">{ok}</p>;
  }
  return null;
}
