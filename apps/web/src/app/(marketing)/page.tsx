import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { DiffWindow } from "@/components/marketing/diff-window";
import { VendorMarquee } from "@/components/marketing/vendor-marquee";
import { Reveal } from "@/components/marketing/reveal";

export const metadata: Metadata = {
  title: "Patch — Governed API-Change Remediation",
  description:
    "Patch detects breaking API and SDK changes, proves TypeScript usages across your repositories, and opens draft pull requests when certified rule packs exist.",
};

const CERTIFIED_MATRIX = [
  {
    vendor: "OpenAI Node SDK",
    package: "openai",
    level: "DRAFT_PR",
    scope: "createChatCompletion → chat.completions.create, completion.data unwrap",
    policyGate: "Auto Draft PR (when validation passes)",
  },
  {
    vendor: "Stripe Node SDK",
    package: "stripe",
    level: "DRAFT_PR",
    scope: "customers.create metadata requirement (PAYMENT approval required)",
    policyGate: "Requires Human Approval (PAYMENT risk)",
  },
  {
    vendor: "Twilio Node SDK",
    package: "twilio",
    level: "DRAFT_PR",
    scope: "client.messages.create → client.messages.createV2",
    policyGate: "Auto Draft PR (when validation passes)",
  },
  {
    vendor: "Auth0 SDK",
    package: "auth0",
    level: "PLAN",
    scope: "Authentication middleware & JWT signature updates",
    policyGate: "Mandatory Human Approval (AUTH risk) — plan visible, no code patch",
  },
  {
    vendor: "Generic OpenAPI Diff",
    package: "openapi-spec",
    level: "ASSESS",
    scope: "Schema property & response changes from spec diffs",
    policyGate: "Observe & assess impact only — no automated code patch",
  },
];

const PRICING = [
  {
    tier: "Free",
    price: "$0",
    cadence: "forever",
    repos: "1 active repository",
    cta: "Start free",
    highlight: false,
  },
  {
    tier: "Pro",
    price: "$149",
    cadence: "/month",
    repos: "10 active repositories",
    cta: "Start with Pro",
    highlight: true,
  },
  {
    tier: "Team",
    price: "$499",
    cadence: "/month",
    repos: "50 active repositories",
    cta: "Start with Team",
    highlight: false,
  },
  {
    tier: "Enterprise",
    price: "Custom",
    cadence: "",
    repos: "Unlimited repositories",
    cta: "Talk to us",
    highlight: false,
  },
];

const STEPS = [
  {
    number: "01",
    title: "Watchtower detects & matches",
    body: "Patch monitors npm releases, GitHub changelogs, and OpenAPI spec diffs for tracked vendors, classifying changes and matching them against exact AST callsites in your TypeScript repositories.",
  },
  {
    number: "02",
    title: "Certified rule packs patch",
    body: "For certified SDKs (OpenAI, Stripe, Twilio, Anthropic, AWS SDK, Supabase), deterministic migration rules apply bounded code patches. Every patch is validated against allowlisted test commands in an isolated sandbox runner before attachment.",
  },
  {
    number: "03",
    title: "You review and approve",
    body: "Patch opens draft pull requests only and never auto-merges. High-risk paths (payments, authentication, webhooks) require explicit human approval before PR creation.",
  },
];

const AUDIT_LINES = [
  {
    case: "c_8f2f",
    event: "OBSERVED",
    detail: "openai@4.0.0 released on npm",
    tone: "text-ink-400",
  },
  { case: "c_8f2f", event: "ANALYST", detail: "matched 14 AST callsites", tone: "text-accent-300" },
  {
    case: "c_8f2f",
    event: "PATCH",
    detail: "applied · sandbox validation passed",
    tone: "text-mint-300",
  },
  {
    case: "c_8f2f",
    event: "APPROVED",
    detail: "by e.owens · draft PR #128 opened",
    tone: "text-mint-300",
  },
];

const LEVEL_BADGE: Record<string, string> = {
  DRAFT_PR: "border-mint-400/30 bg-mint-400/10 text-mint-300",
  PLAN: "border-accent-400/30 bg-accent-500/15 text-accent-300",
  ASSESS: "border-white/10 bg-white/5 text-ink-300",
};

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CheckBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7M18 10.5c0 3-3 3.5-6 3.5s-6 .5-6 3.5" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5">
      <path d="M12 3a3 3 0 0 0-3 3c0 .5.1 1 .3 1.4A3 3 0 0 0 7 7a3 3 0 0 0-2 5.2A3 3 0 0 0 7 17h.5a3 3 0 0 0 5 2.2A3 3 0 0 0 15 21a3 3 0 0 0 2-5.2 3 3 0 0 0 1-4.8A3 3 0 0 0 15 7a3 3 0 0 0-3-4z" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="flex-1 bg-ink-950 text-ink-100">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 grid-bg" />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(99,102,241,0.28),transparent)]"
        />
        <div
          aria-hidden
          className="absolute -left-40 top-10 size-[480px] animate-aurora rounded-full bg-accent-600/20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -right-32 top-40 size-[420px] animate-aurora rounded-full bg-accent-400/15 blur-3xl"
          style={{ animationDelay: "-8s" }}
        />

        <div className="relative mx-auto w-full max-w-6xl px-4 pt-20 pb-10 text-center">
          <p
            className="animate-rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-wide text-ink-300"
            style={{ animationDelay: "0.05s" }}
          >
            <span className="size-1.5 animate-pulse-dot rounded-full bg-mint-400" />
            Governed API-change remediation
          </p>

          <h1
            className="animate-rise mx-auto mt-6 max-w-4xl text-5xl font-bold leading-[1.05] tracking-tight text-ink-100 sm:text-6xl lg:text-7xl"
            style={{ animationDelay: "0.15s" }}
          >
            Dependabot tells you a version changed.
            <span className="text-gradient block">Patch drafts the migration code.</span>
          </h1>

          <p
            className="animate-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-300"
            style={{ animationDelay: "0.3s" }}
          >
            A neutral GitHub App that detects SDK and API changes, proves TypeScript usages across
            your repositories, and opens a reviewable draft pull request when a certified rule pack
            exists.
          </p>

          <div
            className="animate-rise mt-9 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "0.45s" }}
          >
            <Link
              href="/api/github/install"
              className="btn-glow rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 px-6 py-3 text-sm font-semibold text-white"
            >
              Install GitHub App
            </Link>
            <Link
              href="/login"
              className="glass rounded-xl px-6 py-3 text-sm font-medium text-ink-200 transition-colors hover:border-white/20 hover:text-ink-100"
            >
              Explore the demo
            </Link>
          </div>

          <p className="animate-rise mt-6 text-xs text-ink-500" style={{ animationDelay: "0.55s" }}>
            Vendors can push change events directly with{" "}
            <code className="font-mono text-ink-400">pb_agent_*</code> keys to{" "}
            <code className="font-mono text-ink-400">POST /api/vendors/:slug/events</code>.
          </p>

          <DiffWindow />
        </div>
      </section>

      <VendorMarquee />

      {/* Governance bento */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">
              Governed by default
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-100 sm:text-4xl">
              Automation with a hard stop before merge
            </h2>
            <p className="mt-3 text-ink-400">
              Patch moves fast where it is certified to, and refuses to guess everywhere else. Every
              decision is recorded, every patch validated, every PR reviewable.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Audit trail — large cell */}
          <Reveal className="sm:col-span-2 lg:col-span-4 lg:row-span-2">
            <div className="card-lift glass h-full rounded-2xl p-6">
              <div className="flex items-center gap-2 text-ink-300">
                <ActivityIcon />
                <h3 className="font-semibold text-ink-100">An audit trail you can replay</h3>
              </div>
              <p className="mt-2 text-sm text-ink-400">
                Every detection, classification, decision, and approval is appended immutably with a
                correlation ID — the full story behind every draft PR.
              </p>
              <div className="mt-5 overflow-hidden rounded-xl border border-white/8 bg-ink-950/70 font-mono text-xs leading-6">
                {AUDIT_LINES.map((line) => (
                  <div key={line.event} className="flex items-center gap-2 px-3 hover:bg-white/5">
                    <span className="text-ink-600">{line.case}</span>
                    <span className={`font-semibold ${line.tone}`}>{line.event}</span>
                    <span className="truncate text-ink-300">{line.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Draft PRs only */}
          <Reveal delay={80} className="sm:col-span-2 lg:col-span-2">
            <div className="card-lift glass h-full rounded-2xl p-6">
              <div className="flex items-center gap-2 text-mint-300">
                <GitBranchIcon />
                <h3 className="font-semibold text-ink-100">Draft PRs only</h3>
              </div>
              <p className="mt-2 text-sm text-ink-400">
                Patch opens a draft and stops there. Merging stays a human decision, every time.
              </p>
              <p className="mt-4 rounded-lg border border-mint-400/20 bg-mint-400/5 px-3 py-2 font-mono text-xs text-mint-300">
                + draft: true — never auto-merge
              </p>
            </div>
          </Reveal>

          {/* Policy gates */}
          <Reveal delay={160} className="sm:col-span-2 lg:col-span-2">
            <div className="card-lift glass h-full rounded-2xl p-6">
              <div className="flex items-center gap-2 text-accent-300">
                <LockIcon />
                <h3 className="font-semibold text-ink-100">Policy gates</h3>
              </div>
              <p className="mt-2 text-sm text-ink-400">
                High-risk surfaces require explicit approval before any code is pushed.
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {["PAYMENT", "AUTH", "WEBHOOK"].map((risk) => (
                  <span
                    key={risk}
                    className="rounded-md border border-accent-400/25 bg-accent-500/10 px-2 py-1 font-mono text-[11px] font-medium text-accent-300"
                  >
                    {risk}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Sandbox validation */}
          <Reveal delay={80} className="sm:col-span-2 lg:col-span-2">
            <div className="card-lift glass h-full rounded-2xl p-6">
              <div className="flex items-center gap-2 text-mint-300">
                <CheckBadgeIcon />
                <h3 className="font-semibold text-ink-100">Sandbox-validated</h3>
              </div>
              <p className="mt-2 text-sm text-ink-400">
                Migration code runs only allowlisted commands in an isolated runner before any draft
                PR is created.
              </p>
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-ink-950/70 px-3 py-2 font-mono text-xs text-ink-300">
                <span className="size-1.5 rounded-full bg-mint-400" />
                pnpm test
                <span className="ml-auto text-mint-300">passed ✓</span>
              </p>
            </div>
          </Reveal>

          {/* Agent trail */}
          <Reveal delay={160} className="sm:col-span-2 lg:col-span-2">
            <div className="card-lift glass h-full rounded-2xl p-6">
              <div className="flex items-center gap-2 text-accent-300">
                <BrainIcon />
                <h3 className="font-semibold text-ink-100">Visible agent trail</h3>
              </div>
              <p className="mt-2 text-sm text-ink-400">
                Analyst → planner → reviewer. You watch every step, every tool call, every verdict.
              </p>
              <div className="mt-4 space-y-1.5">
                {["ANALYST · listening", "PLANNER · composing", "REVIEWER · shaping"].map(
                  (step) => (
                    <p
                      key={step}
                      className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-[11px] text-ink-300"
                    >
                      <span className="size-1.5 animate-pulse-dot rounded-full bg-accent-400" />
                      {step}
                    </p>
                  ),
                )}
              </div>
            </div>
          </Reveal>

          {/* Deterministic by default */}
          <Reveal delay={240} className="sm:col-span-2 lg:col-span-2">
            <div className="card-lift glass h-full rounded-2xl p-6">
              <div className="flex items-center gap-2 text-ink-200">
                <ShieldIcon />
                <h3 className="font-semibold text-ink-100">Deterministic by default</h3>
              </div>
              <p className="mt-2 text-sm text-ink-400">
                Certified rule packs apply bounded, exact AST patches — AI proposes, rules execute.
              </p>
              <p className="mt-4 flex items-baseline gap-2 rounded-lg bg-ink-950/70 px-3 py-2">
                <span className="font-mono text-lg font-semibold text-accent-300">14</span>
                <span className="font-mono text-[11px] text-ink-400">AST callsites matched</span>
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-white/8 bg-ink-900/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">
                Pipeline
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-100 sm:text-4xl">
                From release note to reviewed patch
              </h2>
            </div>
          </Reveal>

          <div className="relative mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div
              aria-hidden
              className="absolute left-[27px] top-0 hidden h-full w-px bg-gradient-to-b from-accent-500/40 via-white/10 to-transparent lg:block lg:left-0 lg:top-6 lg:right-0 lg:h-px lg:w-full lg:bg-gradient-to-r"
            />
            {STEPS.map((step, index) => (
              <Reveal key={step.number} delay={index * 140}>
                <div className="card-lift glass relative h-full rounded-2xl p-6">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500 to-accent-600 font-mono text-sm font-bold text-white shadow-[0_0_28px_rgba(99,102,241,0.45)]">
                    {step.number}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-ink-100">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-400">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Support matrix */}
      <section id="support-matrix" className="mx-auto w-full max-w-6xl px-4 py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">
              Honest capability matrix
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-100 sm:text-4xl">
              What Patch can patch — and what it won&apos;t
            </h2>
            <p className="mt-3 text-ink-400">
              A 56-connector catalog powers dependency detection and impact assessment. Automated
              draft PRs are strictly limited to certified rule packs.
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-10 overflow-hidden rounded-2xl border border-white/8 glass">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/8 bg-ink-900/60 text-xs uppercase tracking-wider text-ink-400">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold">Vendor / Integration</th>
                    <th className="px-5 py-3.5 font-semibold">Certified Level</th>
                    <th className="px-5 py-3.5 font-semibold">Scope & Capabilities</th>
                    <th className="px-5 py-3.5 font-semibold">Policy Gate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8">
                  {CERTIFIED_MATRIX.map((row) => (
                    <tr key={row.vendor} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-5 py-4">
                        <p className="font-medium text-ink-100">{row.vendor}</p>
                        <p className="font-mono text-xs text-ink-500">{row.package}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold ${LEVEL_BADGE[row.level] ?? LEVEL_BADGE.ASSESS}`}
                        >
                          {row.level}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs leading-relaxed text-ink-400">
                        {row.scope}
                      </td>
                      <td className="px-5 py-4 text-xs leading-relaxed text-ink-400">
                        {row.policyGate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        <Reveal delay={160}>
          <p className="mt-4 text-center text-xs text-ink-500">
            Catalog membership ≠ auto-PR. Automated code patches require a certified rule pack,
            validation profile, and passing evaluation corpus metrics.
          </p>
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-white/8 bg-ink-900/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-20">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">
                Pricing
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink-100 sm:text-4xl">
                Scales with the repositories you watch
              </h2>
              <p className="mt-3 text-ink-400">
                Every plan includes vendor tracking, AST impact analysis, sandbox validation, and
                draft pull requests. Plans differ only in how many active repositories Patch
                watches.
              </p>
            </div>
          </Reveal>

          <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRICING.map((plan, index) => (
              <Reveal key={plan.tier} delay={index * 100}>
                <div
                  className={
                    plan.highlight
                      ? "relative h-full rounded-2xl bg-gradient-to-b from-accent-400/70 to-accent-600/20 p-px shadow-[0_24px_70px_-28px_rgba(99,102,241,0.6)]"
                      : "h-full rounded-2xl border border-white/8"
                  }
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-accent-500 to-accent-600 px-3 py-1 text-[11px] font-semibold text-white">
                      Most popular
                    </span>
                  )}
                  <div
                    className={`flex h-full flex-col rounded-2xl p-6 ${
                      plan.highlight ? "bg-ink-900/95" : "glass"
                    }`}
                  >
                    <p className="text-sm font-semibold text-ink-300">{plan.tier}</p>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-ink-100">
                      {plan.price}
                      {plan.cadence && (
                        <span className="ml-1 text-sm font-normal text-ink-400">
                          {plan.cadence}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-ink-400">{plan.repos}</p>
                    <ul className="mt-5 flex-1 space-y-2 text-xs text-ink-400">
                      <li className="flex items-center gap-2">
                        <span className="size-1 rounded-full bg-accent-400" /> Vendor tracking
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="size-1 rounded-full bg-accent-400" /> AST impact analysis
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="size-1 rounded-full bg-accent-400" /> Sandbox validation
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="size-1 rounded-full bg-accent-400" /> Draft PRs
                      </li>
                    </ul>
                    <a
                      href="/api/github/install"
                      className={
                        plan.highlight
                          ? "btn-glow mt-6 block rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 px-3 py-2.5 text-center text-sm font-semibold text-white"
                          : "mt-6 block rounded-xl border border-white/10 px-3 py-2.5 text-center text-sm font-medium text-ink-200 transition-colors hover:border-white/20 hover:bg-white/5"
                      }
                    >
                      {plan.cta}
                    </a>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <p className="mt-8 text-center text-xs text-ink-500">
              Listed pricing is list pricing; payment checkout is enabled via Stripe in the
              dashboard when billing environment variables are configured.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_50%_60%_at_50%_100%,rgba(99,102,241,0.25),transparent)]"
        />
        <div className="relative mx-auto w-full max-w-4xl px-4 py-24 text-center">
          <Reveal>
            <h2 className="text-4xl font-bold tracking-tight text-ink-100 sm:text-5xl">
              Never chase a breaking change again.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-ink-400">
              Install the Patch GitHub App and get your first migration draft on the next release.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/api/github/install"
                className="btn-glow rounded-xl bg-gradient-to-r from-accent-500 to-accent-600 px-7 py-3.5 text-sm font-semibold text-white"
              >
                Install GitHub App
              </Link>
              <Link
                href="/login"
                className="glass rounded-xl px-7 py-3.5 text-sm font-medium text-ink-200 transition-colors hover:border-white/20 hover:text-ink-100"
              >
                Explore the demo
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
