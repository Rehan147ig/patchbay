import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import {
  createStripeClient,
  formatPrice,
  PLAN_DEFINITIONS,
  repositoryCapacity,
  stripePriceIdForTier,
} from "@patchbay/billing";
import {
  CAPABILITY_LEVELS,
  getCapability,
  type CapabilityLevel,
} from "@patchbay/vendor-connectors";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@patchbay/ui";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { getEffectivePlan } from "@/lib/billing";
import { isLegacyAgentKeyHash } from "@/lib/agent-keys";
import { BillingActions } from "@/components/billing-actions";
import { CapabilityGateControl } from "@/components/capability-gate-control";
import { PrivateVendorForm } from "@/components/private-vendor-form";
import { VendorAgentKeyControl } from "@/components/vendor-agent-key-control";
import { formatDate, GATE_STATUS_TONE } from "@/lib/format";

export const metadata: Metadata = {
  title: "Settings",
};

const CAPABILITY_BADGE_TONE: Record<CapabilityLevel, "neutral" | "blue" | "purple" | "green"> = {
  DETECT: "neutral",
  ASSESS: "neutral",
  PLAN: "blue",
  VALIDATE: "purple",
  DRAFT_PR: "green",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ capability?: string; billing?: string }>;
}) {
  const { capability: capabilityFilter, billing: billingStatus } = await searchParams;
  const user = await requireUser();
  const [organization, vendors, plan, activeRepositories, capabilityGates] = await Promise.all([
    prisma.organization.findUnique({ where: { id: user.organizationId } }),
    prisma.vendor.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: user.organizationId }] },
      orderBy: [{ organizationId: "asc" }, { name: "asc" }],
    }),
    getEffectivePlan(user.organizationId),
    prisma.repository.count({ where: { organizationId: user.organizationId, status: "ACTIVE" } }),
    prisma.capabilityGate.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ vendorSlug: "asc" }, { level: "asc" }],
    }),
  ]);

  const minLevel = CAPABILITY_LEVELS.includes(capabilityFilter as CapabilityLevel)
    ? (capabilityFilter as CapabilityLevel)
    : null;
  const visibleVendors = vendors.filter((vendor) => {
    if (minLevel === null) {
      return true;
    }
    const capability = getCapability(vendor.slug);
    if (!capability) {
      return false;
    }
    return CAPABILITY_LEVELS.indexOf(capability.level) >= CAPABILITY_LEVELS.indexOf(minLevel);
  });

  const capacity = repositoryCapacity(plan.tier, activeRepositories);
  const billingConfigured = createStripeClient(env) !== null;
  const upgradeableTiers = (["PRO", "TEAM"] as const).filter(
    (tier) => stripePriceIdForTier(tier, env) !== null,
  );

  return (
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <PageHeader
        title="Workspace Settings"
        description="Configure tenant profile, vendor catalog integration keys, billing tier, and capability kill switches."
        badge={
          <Badge tone="purple" variant="subtle" dot>
            {user.role} Access
          </Badge>
        }
      />

      {billingStatus === "success" ? (
        <div
          role="status"
          className="rounded-[16px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-[13px] font-medium tracking-tight text-emerald-800"
        >
          Subscription updated — your new plan is active. Receipts go to the billing email on file.
        </div>
      ) : null}
      {billingStatus === "cancelled" ? (
        <div
          role="status"
          className="rounded-[16px] border border-zinc-200 bg-zinc-50 px-5 py-4 text-[13px] font-medium tracking-tight text-zinc-600"
        >
          Checkout cancelled — your plan is unchanged. You can upgrade anytime below.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle>Organization Profile</CardTitle>
            <CardDescription>Tenant workspace identity and session context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <span className="text-xs font-medium text-zinc-500">Organization Name</span>
              <span className="text-[13px] font-semibold tracking-tight text-[#1d1d1f]">
                {organization?.name ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <span className="text-xs font-medium text-zinc-500">Organization ID</span>
              <span className="font-mono text-xs font-medium text-[#0071e3]">
                {user.organizationId}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Signed-in User</span>
              <span className="font-mono text-xs text-zinc-600">{user.email}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle>Monitored vendors</CardTitle>
            <CardDescription>
              Vendor catalog entries available for change monitoring. Admins can issue a{" "}
              <code className="font-mono text-xs">pb_agent_*</code> agent key per vendor so the
              vendor can push change events directly — Patch never writes to customer repositories.
              The plaintext key is shown exactly once; only its hash is stored.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="mb-3 flex items-center gap-2">
              <label htmlFor="capability-filter" className="text-xs font-medium text-zinc-500">
                Certified capability
              </label>
              <select
                id="capability-filter"
                name="capability"
                className="h-8 rounded-xl border border-zinc-200 bg-white px-2.5 text-xs font-medium text-[#1d1d1f] shadow-sm focus:border-[#0071e3] focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20"
                defaultValue={minLevel ?? ""}
              >
                <option value="">All vendors</option>
                {CAPABILITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}+
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="h-8 rounded-full bg-[#0071e3] px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#0077ed]"
              >
                Filter
              </button>
            </form>
            <p className="mb-3 text-xs leading-relaxed text-zinc-500">
              Catalog membership ≠ auto-PR. DRAFT_PR requires a live certification kit. Entries with
              a{" "}
              <Badge tone="purple" variant="subtle" className="mx-0.5">
                private
              </Badge>{" "}
              badge are your organization&apos;s internal SDKs — invisible to other tenants.
            </p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleVendors.map((vendor) => {
                const capability = getCapability(vendor.slug);
                const isPrivate = vendor.organizationId !== null;
                return (
                  <li
                    key={vendor.id}
                    className="flex items-center justify-between gap-2 rounded-[16px] border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:border-zinc-300 hover:shadow-[0_4px_12px_rgba(0,0,0,0.04)]"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-[13px] font-semibold tracking-tight text-[#1d1d1f]">
                        {vendor.name}
                        {isPrivate ? (
                          <Badge tone="purple" variant="subtle">
                            private
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-zinc-500">{vendor.category}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {capability ? (
                        <>
                          <Badge tone={CAPABILITY_BADGE_TONE[capability.level]} variant="subtle">
                            {capability.level}
                            {capability.certifiedAt !== null ? " · certified" : ""}
                          </Badge>
                          <span className="hidden text-[11px] text-zinc-400 xl:inline">
                            {capability.language}
                          </span>
                        </>
                      ) : isPrivate ? (
                        <Badge tone="neutral" variant="subtle">
                          ASSESS
                        </Badge>
                      ) : null}
                      <Badge tone={vendor.enabled ? "green" : "neutral"} variant="subtle">
                        {vendor.enabled ? "enabled" : "off"}
                      </Badge>
                      <VendorAgentKeyControl
                        entry={{
                          slug: vendor.slug,
                          name: vendor.name,
                          hasKey: vendor.agentKeyHash !== null,
                          legacyKey:
                            vendor.agentKeyHash !== null &&
                            isLegacyAgentKeyHash(vendor.agentKeyHash),
                        }}
                        isAdmin={user.role === "ADMIN"}
                      />
                    </div>
                  </li>
                );
              })}
              {visibleVendors.length === 0 ? (
                <li className="py-2 text-sm text-zinc-500">No vendors certified at this level.</li>
              ) : null}
            </ul>
            {user.role === "ADMIN" ? (
              <div className="mt-4 rounded-[16px] border border-dashed border-zinc-200 bg-zinc-50 p-4">
                <p className="mb-1 text-[13px] font-semibold tracking-tight text-[#1d1d1f]">
                  Register internal SDK (private vendor)
                </p>
                <p className="mb-3 text-xs leading-relaxed text-zinc-500">
                  Private vendors are visible only inside your organization and can ingest change
                  events through their own agent key.
                </p>
                <PrivateVendorForm />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-[20px] border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle>Plan & billing</CardTitle>
          <CardDescription>
            Subscription tier, repository capacity, and Stripe billing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="blue" variant="subtle">
              {plan.tier}
            </Badge>
            <span className="text-sm font-medium text-[#1d1d1f]">
              {formatPrice(PLAN_DEFINITIONS[plan.tier].priceCents)}
              {plan.status === "ACTIVE" || plan.status === "PAST_DUE" ? (
                <>
                  {" · "}
                  <span className="text-xs font-normal text-zinc-500">
                    {plan.status === "PAST_DUE" ? "payment past due" : "active"}
                    {plan.currentPeriodEnd ? ` · renews ${formatDate(plan.currentPeriodEnd)}` : ""}
                  </span>
                </>
              ) : null}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
              <span>
                Repository usage: {capacity.activeCount}
                {capacity.cap !== null ? ` of ${capacity.cap}` : " (unlimited)"}
              </span>
              {capacity.remaining !== null ? <span>{capacity.remaining} remaining</span> : null}
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
              <div
                className={
                  capacity.remaining === 0 && capacity.cap !== null
                    ? "h-full rounded-full bg-[#ff3b30]"
                    : "h-full rounded-full bg-[#0071e3]"
                }
                style={{
                  width:
                    capacity.cap === null
                      ? "100%"
                      : `${Math.min(100, (capacity.activeCount / Math.max(1, capacity.cap)) * 100)}%`,
                }}
              />
            </div>
            {capacity.remaining === 0 && capacity.cap !== null ? (
              <p className="mt-2 text-xs font-medium text-[#ff3b30]">
                Repository capacity reached — upgrade to connect more.
              </p>
            ) : null}
          </div>

          {!billingConfigured ? (
            <p className="text-xs leading-relaxed text-zinc-500">
              Billing is not configured for this deployment — every workspace stays on {plan.tier}.
              Set <code className="font-mono text-[#1d1d1f]">STRIPE_SECRET_KEY</code> to enable
              checkout.
            </p>
          ) : (
            <BillingActions
              upgradeableTiers={upgradeableTiers}
              hasStripeCustomer={plan.stripeCustomerId !== null}
            />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[20px] border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle>Capability gates</CardTitle>
          <CardDescription>
            Kill switches for vendor capabilities. Gates are created on first evaluation and are
            suspended automatically when outcome SLOs degrade (merge rate &lt; 50%, false positive
            rate &gt; 50%, or p95 detection latency &gt; 60s over 30 days).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {capabilityGates.length === 0 ? (
            <div className="px-6 py-4 text-sm text-zinc-500">
              No gates yet — they appear once pull-request outcomes have been recorded and
              evaluated.
            </div>
          ) : (
            <Table className="rounded-none border-0 shadow-none">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Vendor</TableHeaderCell>
                  <TableHeaderCell>Level</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Since</TableHeaderCell>
                  <TableHeaderCell>Control</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {capabilityGates.map((gate) => {
                  const vendor = vendors.find((v) => v.slug === gate.vendorSlug);
                  return (
                    <TableRow key={gate.id}>
                      <TableCell className="text-[13px] font-medium tracking-tight text-[#1d1d1f]">
                        {vendor?.name ?? gate.vendorSlug}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-zinc-600">
                        {gate.level}
                      </TableCell>
                      <TableCell>
                        <StatusPill
                          label={gate.status.toLowerCase()}
                          tone={GATE_STATUS_TONE[gate.status]}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">
                        {gate.suspendedAt ? formatDate(gate.suspendedAt) : "—"}
                      </TableCell>
                      <TableCell>
                        <CapabilityGateControl
                          gate={{
                            vendorSlug: gate.vendorSlug,
                            vendorName: vendor?.name ?? gate.vendorSlug,
                            level: gate.level,
                            status: gate.status,
                            reason: gate.reason,
                          }}
                          isAdmin={user.role === "ADMIN"}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[20px] border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle>Local development notice</CardTitle>
          <CardDescription>Safety boundaries of this MVP.</CardDescription>
        </CardHeader>
        <CardContent className="text-[13px] leading-relaxed text-zinc-600">
          <ul className="list-disc space-y-1.5 pl-4 marker:text-zinc-300">
            <li>
              Validation mode:{" "}
              <span className="font-mono text-xs font-medium text-[#1d1d1f]">
                {process.env.SANDBOX_VALIDATION_MODE ?? "hosted-docker"}
              </span>{" "}
              (
              {process.env.SANDBOX_VALIDATION_MODE === "github-checks-only"
                ? "customer CI is the validation sandbox — Patch never executes customer code on this host"
                : process.env.SANDBOX_VALIDATION_MODE === "process"
                  ? "development/local only — not a multi-tenant sandbox"
                  : "hosted Docker container isolation (production fail-closed)"}
              ).
            </li>
            <li>
              Validation runner runtime:{" "}
              <span className="font-mono text-xs font-medium text-[#1d1d1f]">
                {process.env.SANDBOX_RUNTIME ?? "process"}
              </span>{" "}
              (
              {process.env.SANDBOX_RUNTIME === "container"
                ? "container isolation"
                : "development/local only — not a multi-tenant sandbox"}
              ).
            </li>
            <li>
              Validation runs execute only allowlisted commands with timeouts and output caps.
            </li>
            <li>Pull requests are created as drafts only and are never auto-merged.</li>
            <li>Payment, auth, PII, webhook, and infrastructure changes require human approval.</li>
            <li>
              The bundled sandbox and dev authentication are local-development tools, not hardened
              multi-tenant infrastructure.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
