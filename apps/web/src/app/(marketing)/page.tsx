import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Patchbay — Governed API-Change Remediation",
  description:
    "Patchbay detects breaking API and SDK changes, proves TypeScript usages across your repositories, and opens draft pull requests when certified rule packs exist.",
};

const CERTIFIED_MATRIX = [
  {
    vendor: "OpenAI Node SDK",
    package: "openai",
    level: "DRAFT_PR",
    scope: "createChatCompletion → chat.completions.create, completion.data unwrap",
    policyGate: "Auto Draft PR (when validation passes)",
    status: "Certified",
  },
  {
    vendor: "Stripe Node SDK",
    package: "stripe",
    level: "DRAFT_PR",
    scope: "customers.create metadata requirement (PAYMENT approval required)",
    policyGate: "Requires Human Approval (PAYMENT risk)",
    status: "Certified",
  },
  {
    vendor: "Twilio Node SDK",
    package: "twilio",
    level: "DRAFT_PR",
    scope: "client.messages.create → client.messages.createV2",
    policyGate: "Auto Draft PR (when validation passes)",
    status: "Certified",
  },
  {
    vendor: "Auth0 SDK",
    package: "auth0",
    level: "PLAN",
    scope: "Authentication middleware & JWT signature updates",
    policyGate: "Mandatory Human Approval (AUTH risk) — plan visible, no code patch",
    status: "Certified Plan-Only",
  },
  {
    vendor: "Generic OpenAPI Diff",
    package: "openapi-spec",
    level: "ASSESS",
    scope: "Schema property & response changes from spec diffs",
    policyGate: "Observe & assess impact only — no automated code patch",
    status: "Observe & Assess",
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
    body: "Patchbay monitors npm releases, GitHub changelogs, and OpenAPI spec diffs for tracked vendors, classifying changes and matching them against exact AST callsites in your TypeScript repositories.",
  },
  {
    number: "02",
    title: "Certified rule packs patch",
    body: "For certified SDKs (OpenAI, Stripe, Twilio, Anthropic, AWS SDK, Supabase), deterministic migration rules apply bounded code patches. Every patch is validated against allowlisted test commands in an isolated sandbox runner before attachment.",
  },
  {
    number: "03",
    title: "You review and approve",
    body: "Patchbay opens draft pull requests only and never auto-merges. High-risk paths (payments, authentication, webhooks) require explicit human approval before PR creation.",
  },
];

const GOVERNANCE = [
  {
    title: "Draft PRs only",
    body: "Patchbay opens draft pull requests and stops there. Merging stays a human decision, every time.",
  },
  {
    title: "Policy gates & approvals",
    body: "Payment, authentication, and webhook changes require explicit approval. Policies can block PR creation before code is ever pushed.",
  },
  {
    title: "Validated patches in sandbox",
    body: "Migration code executes allowlisted validation commands in a sandboxed runner before any draft PR is created.",
  },
  {
    title: "Full audit trail",
    body: "Every detection, classification, decision, and approval is recorded immutably with correlation IDs for auditability.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex-1">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
              P
            </span>
            <span className="text-lg font-semibold tracking-tight">Patchbay</span>
          </div>
          <nav aria-label="Marketing" className="flex items-center gap-4 text-sm">
            <a href="#how-it-works" className="text-slate-600 hover:text-slate-900">
              How it works
            </a>
            <a href="#support-matrix" className="text-slate-600 hover:text-slate-900">
              Support Matrix
            </a>
            <a href="#pricing" className="text-slate-600 hover:text-slate-900">
              Pricing
            </a>
            <Link
              href="/login"
              className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign in
            </Link>
            <Link
              href="/api/github/install"
              className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700"
            >
              Install GitHub App
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-blue-600">
            Governed API-change remediation
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Dependabot tells you a version changed.
            <span className="block text-slate-700">Patchbay drafts the migration code.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            A neutral GitHub App that detects SDK and API changes, proves TypeScript usages across
            your repositories, and opens a reviewable draft pull request when a certified rule pack
            exists.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Vendors can also push change events directly with <code>pb_agent_*</code> keys to{" "}
            <code>POST /api/vendors/:slug/events</code>.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/api/github/install"
              className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Install GitHub App
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Explore the demo
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-14 max-w-4xl">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-xl">
            <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-slate-700" />
              <span className="size-2.5 rounded-full bg-slate-700" />
              <span className="size-2.5 rounded-full bg-slate-700" />
              <span className="ml-3 text-xs text-slate-400">openai v3.3.0 → v4.0.0 · draft PR</span>
            </div>
            <pre className="overflow-x-auto px-4 py-4 text-xs leading-relaxed">
              <code>
                <span className="text-slate-500">- import OpenAI from "openai";</span>
                {"\n"}
                <span className="text-slate-500">
                  - const completion = await openai.createChatCompletion(
                </span>
                {"\n"}
                <span className="text-slate-500">- {'{ model: "gpt-4", messages }'};</span>
                {"\n"}
                <span className="text-slate-400">+ import OpenAI from "openai";</span>
                {"\n"}
                <span className="text-emerald-400">+ const client = new OpenAI();</span>
                {"\n"}
                <span className="text-emerald-400">
                  + const completion = await client.chat.completions.create(
                </span>
                {"\n"}
                <span className="text-emerald-400">+ {'{ model: "gpt-4", messages }'};</span>
                {"\n\n"}
                <span className="text-slate-400">
                  {"// Certified rule pack · sandbox validation passed · draft PR"}
                </span>
              </code>
            </pre>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Real output from the certified OpenAI migration rule pack against the legacy fixture.
          </p>
        </div>
      </section>

      <section id="support-matrix" className="border-t border-slate-100 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              Capability & Support Matrix
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Patchbay maintains a 56-connector catalog for dependency detection and impact
              assessment. Automated draft PRs are strictly limited to certified rule packs.
            </p>
          </div>

          <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-700">
                <tr>
                  <th className="px-4 py-3">Vendor / Integration</th>
                  <th className="px-4 py-3">Certified Level</th>
                  <th className="px-4 py-3">Scope & Capabilities</th>
                  <th className="px-4 py-3">Policy Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {CERTIFIED_MATRIX.map((row) => (
                  <tr key={row.vendor}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {row.vendor}
                      <span className="block font-mono text-xs font-normal text-slate-500">
                        {row.package}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                          row.level === "DRAFT_PR"
                            ? "bg-emerald-50 text-emerald-700"
                            : row.level === "PLAN"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.scope}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{row.policyGate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Catalog membership ≠ auto-PR. Automated code patches require a certified rule pack,
            validation profile, and passing evaluation corpus metrics.
          </p>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-slate-100 bg-slate-50">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-900">
            From release note to reviewed patch
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {STEPS.map((step) => (
              <div
                key={step.number}
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <p className="text-xs font-semibold text-blue-600">{step.number}</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
            {GOVERNANCE.map((item) => (
              <div key={item.title} className="rounded-xl border border-slate-200 bg-white p-6">
                <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-900">
          Pricing
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-600">
          Every plan includes vendor tracking, AST impact analysis, validation, and draft pull
          requests. Plans differ only in how many active repositories Patchbay watches.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING.map((plan) => (
            <div
              key={plan.tier}
              className={
                plan.highlight
                  ? "rounded-xl border-2 border-slate-900 bg-slate-900 p-6 text-white shadow-lg"
                  : "rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
              }
            >
              <p
                className={
                  plan.highlight
                    ? "text-sm font-semibold text-slate-300"
                    : "text-sm font-semibold text-slate-500"
                }
              >
                {plan.tier}
              </p>
              <p className="mt-3 text-3xl font-bold tracking-tight">
                {plan.price}
                {plan.cadence && (
                  <span
                    className={
                      plan.highlight
                        ? "ml-1 text-sm font-normal text-slate-300"
                        : "ml-1 text-sm font-normal text-slate-500"
                    }
                  >
                    {plan.cadence}
                  </span>
                )}
              </p>
              <p
                className={
                  plan.highlight ? "mt-1 text-sm text-slate-300" : "mt-1 text-sm text-slate-600"
                }
              >
                {plan.repos}
              </p>
              <a
                href="/api/github/install"
                className={
                  plan.highlight
                    ? "mt-5 block rounded-md bg-white px-3 py-2 text-center text-sm font-medium text-slate-900 hover:bg-slate-100"
                    : "mt-5 block rounded-md border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700 hover:bg-slate-50"
                }
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">
          Listed pricing is list pricing; payment checkout is enabled via Stripe in the dashboard
          when billing environment variables are configured.
        </p>
      </section>
    </div>
  );
}
