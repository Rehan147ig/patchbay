import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "API-change remediation that writes the fix",
  description:
    "Patchbay detects breaking API and SDK changes, finds every affected call in your repositories, and drafts the migration code for review.",
};

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
    title: "Watchtower detects",
    body: "Patchbay tracks the npm releases and GitHub changelogs of the vendors you depend on, classifies breaking changes, and matches them to the exact lines in your codebase that call the affected APIs.",
  },
  {
    number: "02",
    title: "Patchbay writes the fix",
    body: "Deterministic migration rules turn the release diff into a code patch. Every patch is validated against your own allowlisted test commands before it is ever attached to a pull request.",
  },
  {
    number: "03",
    title: "You approve",
    body: "High-risk changes — payments, auth, webhooks, secrets — always require a human decision. Everything Patchbay does is a draft PR and a complete audit trail. It never auto-merges.",
  },
];

const GOVERNANCE = [
  {
    title: "Draft PRs only",
    body: "Patchbay opens draft pull requests and stops there. Merging stays a human decision, every time.",
  },
  {
    title: "Policy gates",
    body: "Payment, authentication, and webhook changes require explicit approval. Plans can be blocked before they ever reach a PR.",
  },
  {
    title: "Validated patches",
    body: "Migration code runs against your allowlisted validation commands in a sandboxed runner before it ships as a suggestion.",
  },
  {
    title: "Full audit trail",
    body: "Every detection, classification, decision, and approval is recorded immutably — for your security review, not ours.",
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
            <span className="block text-slate-700">Patchbay writes the code to fix it.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            When a vendor breaks its API, Patchbay finds every affected call across your
            repositories, drafts the migration code, and opens a reviewable pull request — gated by
            your policies, never by guesswork.
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
                  {"// 2 affected callsites in ai-assistant-service · awaiting approval"}
                </span>
              </code>
            </pre>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Real output from the seeded demo — same fixture, same draft PR Patchbay would open.
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
          Every plan includes unlimited vendor tracking, patch generation, validation, and draft
          pull requests. Plans differ only in how many repositories Patchbay may watch.
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
          Local MVP pricing is illustrative; checkout is wired to Stripe in the dashboard when
          billing is configured.
        </p>
      </section>
    </div>
  );
}
