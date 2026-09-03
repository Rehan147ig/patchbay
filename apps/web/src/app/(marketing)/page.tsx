import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { HeroMockup } from "@/components/marketing/hero-mockup";
import { VendorLogoWall } from "@/components/marketing/vendor-logos";
import { PipelineShowcase } from "@/components/marketing/pipeline-showcase";
import { Reveal } from "@/components/marketing/reveal";

export const metadata: Metadata = {
  title: "Patch â€” Governed API-Change Remediation",
  description:
    "Patch detects breaking API and SDK changes, proves TypeScript usages across your repositories, and opens draft pull requests when certified rule packs exist.",
};

const CERTIFIED_MATRIX = [
  {
    vendor: "OpenAI Node SDK",
    package: "openai",
    level: "DRAFT_PR",
    scope: "createChatCompletion â†’ chat.completions.create, completion.data unwrap",
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
    scope: "client.messages.create â†’ client.messages.createV2",
    policyGate: "Auto Draft PR (when validation passes)",
  },
  {
    vendor: "Auth0 SDK",
    package: "auth0",
    level: "PLAN",
    scope: "Authentication middleware & JWT signature updates",
    policyGate: "Mandatory Human Approval (AUTH risk) â€” plan visible, no code patch",
  },
  {
    vendor: "Generic OpenAPI Diff",
    package: "openapi-spec",
    level: "ASSESS",
    scope: "Schema property & response changes from spec diffs",
    policyGate: "Observe & assess impact only â€” no automated code patch",
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

const AUDIT_LINES = [
  {
    case: "c_8f2f",
    event: "OBSERVED",
    detail: "openai@4.0.0 released on npm",
    tone: "text-gray-400",
  },
  { case: "c_8f2f", event: "ANALYST", detail: "matched 14 AST callsites", tone: "text-indigo-300" },
  {
    case: "c_8f2f",
    event: "PATCH",
    detail: "applied Â· sandbox validation passed",
    tone: "text-emerald-300",
  },
  {
    case: "c_8f2f",
    event: "APPROVED",
    detail: "by e.owens Â· draft PR #128 opened",
    tone: "text-emerald-300",
  },
];

const FEATURES = [
  {
    icon: "activity",
    title: "An audit trail you can replay",
    body: "Every detection, classification, decision, and approval is appended immutably with a correlation ID â€” the full story behind every draft PR.",
    visual: "audit" as const,
  },
  {
    icon: "branch",
    title: "Draft PRs only",
    body: "Patch opens a draft and stops there. Merging stays a human decision, every time.",
    visual: "draft" as const,
  },
  {
    icon: "lock",
    title: "Policy gates",
    body: "High-risk surfaces require explicit approval before any code is pushed.",
    visual: "gates" as const,
  },
  {
    icon: "check",
    title: "Sandbox-validated",
    body: "Migration code runs only allowlisted commands in an isolated runner before any draft PR is created.",
    visual: "sandbox" as const,
  },
  {
    icon: "brain",
    title: "Visible agent trail",
    body: "Analyst â†’ planner â†’ reviewer. You watch every step, every tool call, every verdict.",
    visual: "agents" as const,
  },
  {
    icon: "shield",
    title: "Deterministic by default",
    body: "Certified rule packs apply bounded, exact AST patches. AI proposes, rules execute.",
    visual: "deterministic" as const,
  },
];

const LEVEL_BADGE: Record<string, string> = {
  DRAFT_PR: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PLAN: "border-indigo-200 bg-indigo-50 text-indigo-700",
  ASSESS: "border-gray-200 bg-gray-100 text-gray-600",
};

function FeatureIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    className: "size-5 text-accent-600",
  };
  if (name === "shield")
    return (
      <svg {...common}>
        <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
      </svg>
    );
  if (name === "lock")
    return (
      <svg {...common}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    );
  if (name === "check")
    return (
      <svg {...common}>
        <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
        <path d="M8.5 12l2.5 2.5 4.5-5" />
      </svg>
    );
  if (name === "branch")
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="8" r="2.5" />
        <path d="M6 8.5v7M18 10.5c0 3-3 3.5-6 3.5s-6 .5-6 3.5" />
      </svg>
    );
  if (name === "activity")
    return (
      <svg {...common}>
        <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 3a3 3 0 0 0-3 3c0 .5.1 1 .3 1.4A3 3 0 0 0 7 7a3 3 0 0 0-2 5.2A3 3 0 0 0 7 17h.5a3 3 0 0 0 5 2.2A3 3 0 0 0 15 21a3 3 0 0 0 2-5.2 3 3 0 0 0 1-4.8A3 3 0 0 0 15 7a3 3 0 0 0-3-4z" />
    </svg>
  );
}

function FeatureVisual({
  kind,
}: {
  kind: "audit" | "draft" | "gates" | "sandbox" | "agents" | "deterministic";
}) {
  if (kind === "audit") {
    return (
      <div className="mt-5 overflow-hidden rounded-lg border border-gray-800 bg-gray-950 font-mono text-[11px] leading-6">
        {AUDIT_LINES.map((line) => (
          <div key={line.event} className="flex items-center gap-2 px-3">
            <span className="text-gray-600">{line.case}</span>
            <span className={`font-semibold ${line.tone}`}>{line.event}</span>
            <span className="truncate text-gray-400">{line.detail}</span>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "draft") {
    return (
      <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-mono text-xs text-emerald-700">
        + draft: true â€” never auto-merge
      </p>
    );
  }
  if (kind === "gates") {
    return (
      <div className="mt-4 flex flex-wrap gap-1.5">
        {["PAYMENT", "AUTH", "WEBHOOK"].map((risk) => (
          <span
            key={risk}
            className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-mono text-[11px] font-medium text-indigo-700"
          >
            {risk}
          </span>
        ))}
      </div>
    );
  }
  if (kind === "sandbox") {
    return (
      <p className="mt-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-600">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
        pnpm test
        <span className="ml-auto text-emerald-600">passed âœ“</span>
      </p>
    );
  }
  if (kind === "agents") {
    return (
      <div className="mt-4 space-y-1.5">
        {["ANALYST Â· listening", "PLANNER Â· composing", "REVIEWER Â· shaping"].map((step) => (
          <p key={step} className="flex items-center gap-2 font-mono text-[11px] text-gray-500">
            <span className="size-1.5 rounded-full bg-accent-500" />
            {step}
          </p>
        ))}
      </div>
    );
  }
  return (
    <p className="mt-4 flex items-baseline gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <span className="font-mono text-lg font-semibold text-accent-600">14</span>
      <span className="font-mono text-[11px] text-gray-500">AST callsites matched</span>
    </p>
  );
}

const PRIMARY_BTN =
  "inline-flex items-center justify-center rounded-full bg-[#0071e3] px-6 h-11 text-sm font-medium tracking-tight text-white shadow-sm transition-colors hover:bg-[#0077ed]";
const SECONDARY_BTN =
  "inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white px-6 h-11 text-sm font-medium tracking-tight text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:border-zinc-300";

export default function LandingPage() {
  return (
    <div className="flex-1 bg-[#fbfbfd] font-sans antialiased text-[#1d1d1f]">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#fbfbfd] pb-20 pt-16 sm:pt-24">
        {/* Ambient animated backdrop */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(15,23,42,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.035) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage: "radial-gradient(ellipse 75% 65% at 50% 0%, black 25%, transparent 72%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 75% 65% at 50% 0%, black 25%, transparent 72%)",
            }}
          />
          <div className="absolute -top-32 left-[12%] size-[480px] animate-drift rounded-full bg-indigo-200/60 blur-3xl" />
          <div
            className="absolute -right-28 top-40 size-[420px] animate-drift rounded-full bg-emerald-100/70 blur-3xl"
            style={{ animationDelay: "-7s" }}
          />
          <div
            className="absolute -left-28 top-64 size-[380px] animate-drift rounded-full bg-sky-100/60 blur-3xl"
            style={{ animationDelay: "-13s" }}
          />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-4 text-center">
          <Reveal>
            <p className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/80 px-4 py-1.5 text-xs font-medium text-gray-600 backdrop-blur">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Governed API-change remediation
            </p>

            <h1 className="mx-auto mt-7 max-w-4xl text-balance text-[32px] font-semibold leading-[1.05] tracking-tight text-[#1d1d1f] sm:text-[48px]">
              Dependabot tells you a version changed.
              <span className="block bg-gradient-to-r from-[#0071e3] to-[#34c759] bg-clip-text text-transparent">
                Patch drafts the migration.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-zinc-500">
              A neutral GitHub App that detects SDK and API changes, proves TypeScript usages across
              your repositories, and opens a reviewable draft pull request when a certified rule
              pack exists.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/api/github/install" className={PRIMARY_BTN}>
                Install GitHub App
              </Link>
              <Link href="/login" className={SECONDARY_BTN}>
                Explore the demo â†’
              </Link>
            </div>

            <p className="mt-6 text-xs text-zinc-400">
              Vendors push change events directly with{" "}
              <code className="font-mono text-zinc-500">pb_agent_*</code> keys to{" "}
              <code className="font-mono text-zinc-500">POST /api/vendors/:slug/events</code>.
            </p>
          </Reveal>

          <Reveal delay={150}>
            <HeroMockup />
          </Reveal>
        </div>
      </section>

      <VendorLogoWall />

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-28">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
              Automation with a hard stop before merge
            </h2>
            <p className="mt-5 text-pretty text-lg text-gray-600">
              Patch moves fast where it is certified to, and refuses to guess everywhere else. Every
              decision recorded, every patch validated, every PR reviewable.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <Reveal key={feature.title} delay={(index % 3) * 90}>
              <div className="h-full rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow duration-300 hover:shadow-[0_20px_50px_-24px_rgba(15,23,42,0.25)]">
                <FeatureIcon name={feature.icon} />
                <h3 className="mt-4 font-semibold text-gray-900">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{feature.body}</p>
                <FeatureVisual kind={feature.visual} />
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works â€” live pipeline pictorial */}
      <section
        id="how-it-works"
        className="relative overflow-hidden border-y border-gray-100 bg-gray-50/70"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 top-1/3 size-[420px] animate-drift rounded-full bg-indigo-100/50 blur-3xl"
        />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-28">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-balance text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
                From release note to reviewed patch â€” live
              </h2>
              <p className="mt-5 text-pretty text-lg text-gray-600">
                Watch the pipeline work: every stage below is what Patch actually does, in the order
                it actually does it.
              </p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-16">
              <PipelineShowcase />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Support matrix */}
      <section id="support-matrix" className="mx-auto w-full max-w-6xl px-4 py-28">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
              What Patch can patch â€” and what it won&apos;t
            </h2>
            <p className="mt-5 text-pretty text-lg text-gray-600">
              7 certified for Draft PR (openai, stripe, twilio, anthropic, supabase, vercel-ai-sdk,
              openai-python) + the rest at ASSESS via graph + blast-radius. Private SDKs via agent.
              Automated Draft PRs are strictly limited to certified rule packs + validation + human
              approval.
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="mt-14 overflow-x-auto rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-5 py-3.5 font-medium">Vendor / Integration</th>
                  <th className="px-5 py-3.5 font-medium">Certified Level</th>
                  <th className="px-5 py-3.5 font-medium">Scope & Capabilities</th>
                  <th className="px-5 py-3.5 font-medium">Policy Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {CERTIFIED_MATRIX.map((row) => (
                  <tr key={row.vendor}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-gray-900">{row.vendor}</p>
                      <p className="font-mono text-xs text-gray-500">{row.package}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${LEVEL_BADGE[row.level] ?? LEVEL_BADGE.ASSESS}`}
                      >
                        {row.level}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs leading-relaxed text-gray-600">{row.scope}</td>
                    <td className="px-5 py-4 text-xs leading-relaxed text-gray-600">
                      {row.policyGate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <p className="mt-5 text-center text-xs text-gray-400">
          Catalog membership â‰  auto-PR. Automated code patches require a certified rule pack,
          validation profile, and passing evaluation corpus metrics.
        </p>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="relative overflow-hidden border-y border-gray-100 bg-gray-50/70"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 bottom-0 size-[420px] animate-drift rounded-full bg-sky-100/50 blur-3xl"
        />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-28">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-balance text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
                Scales with the repositories you watch
              </h2>
              <p className="mt-5 text-pretty text-lg text-gray-600">
                Every plan includes vendor tracking, AST impact analysis, sandbox validation, and
                draft pull requests. Plans differ only in how many active repositories Patch
                watches.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRICING.map((plan, index) => (
              <Reveal key={plan.tier} delay={index * 80}>
                <div
                  className={
                    plan.highlight
                      ? "relative flex h-full flex-col rounded-2xl border border-accent-500 bg-white p-6 shadow-[0_24px_60px_-24px_rgba(79,70,229,0.35)] ring-1 ring-accent-500"
                      : "flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-6"
                  }
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent-600 px-3.5 py-1 text-[11px] font-semibold text-white">
                      Most popular
                    </span>
                  )}
                  <p className="text-sm font-medium text-gray-600">{plan.tier}</p>
                  <p className="mt-3 text-4xl font-semibold tracking-tight text-gray-900">
                    {plan.price}
                    {plan.cadence && (
                      <span className="ml-1 text-base font-normal text-gray-500">
                        {plan.cadence}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">{plan.repos}</p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-sm text-gray-600">
                    {[
                      "Vendor tracking",
                      "AST impact analysis",
                      "Sandbox validation",
                      "Draft PRs",
                    ].map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="size-4 text-emerald-600"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <a
                    href="/api/github/install"
                    className={
                      plan.highlight
                        ? "mt-6 block rounded-full bg-gray-900 px-3 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-gray-700"
                        : "mt-6 block rounded-full border border-gray-300 bg-white px-3 py-2.5 text-center text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    }
                  >
                    {plan.cta}
                  </a>
                </div>
              </Reveal>
            ))}
          </div>

          <p className="mt-10 text-center text-xs text-gray-400">
            Listed pricing is list pricing; payment checkout is enabled via Stripe in the dashboard
            when billing environment variables are configured.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -bottom-40 left-1/2 size-[560px] -translate-x-1/2 animate-drift rounded-full bg-indigo-100/80 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-4xl px-4 py-32 text-center">
          <Reveal>
            <h2 className="text-balance text-5xl font-semibold tracking-[-0.03em] text-gray-900 sm:text-6xl">
              Never chase a breaking change again.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-gray-600">
              Install the Patch GitHub App and get your first migration draft on the next release.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link href="/api/github/install" className={`${PRIMARY_BTN} px-8 py-3.5`}>
                Install GitHub App
              </Link>
              <Link href="/login" className={`${SECONDARY_BTN} px-8 py-3.5`}>
                Explore the demo
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
