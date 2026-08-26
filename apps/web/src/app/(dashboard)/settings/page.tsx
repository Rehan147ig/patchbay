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
  searchParams: Promise<{ capability?: string }>;
}) {
  const { capability: capabilityFilter } = await searchParams;
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
    <div className="space-y-6">
      <PageHeader
        title="Workspace Settings"
        description="Configure tenant profile, vendor catalog integration keys, billing tier, and capability kill switches."
        badge={
          <Badge tone="purple" dot>
            {user.role} Access
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Organization Profile</CardTitle>
            <CardDescription>Tenant workspace identity and session context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-ink-800 pb-2">
              <span className="text-xs text-ink-400">Organization Name</span>
              <span className="font-semibold text-gray-200">{organization?.name ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between border-b border-ink-800 pb-2">
              <span className="text-xs text-ink-400">Organization ID</span>
              <span className="font-mono text-xs text-accent-400">{user.organizationId}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-400">Signed-in User</span>
              <span className="text-xs text-gray-300 font-mono">{user.email}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
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
              <label htmlFor="capability-filter" className="text-xs text-ink-400">
                Certified capability
              </label>
              <select
                id="capability-filter"
                name="capability"
                className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-gray-200"
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
                className="rounded-md bg-accent-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-500"
              >
                Filter
              </button>
            </form>
            <p className="mb-3 text-xs text-ink-400">
              Catalog membership ≠ auto-PR. DRAFT_PR requires a live certification kit. Entries with
              a{" "}
              <Badge tone="purple" className="mx-0.5">
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
                    className="flex items-center justify-between rounded-xl border border-ink-700 bg-ink-800/50 p-4 transition-all hover:border-ink-600"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
                        {vendor.name}
                        {isPrivate ? <Badge tone="purple">private</Badge> : null}
                      </p>
                      <p className="text-xs text-ink-400">{vendor.category}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {capability ? (
                        <>
                          <Badge tone={CAPABILITY_BADGE_TONE[capability.level]}>
                            {capability.level}
                            {capability.certifiedAt !== null ? " · certified" : ""}
                          </Badge>
                          <span className="hidden text-[11px] text-ink-500 xl:inline">
                            {capability.language}
                          </span>
                        </>
                      ) : isPrivate ? (
                        <Badge tone="neutral">ASSESS</Badge>
                      ) : null}
                      <Badge tone={vendor.enabled ? "green" : "neutral"}>
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
                <li className="py-2 text-sm text-ink-400">No vendors certified at this level.</li>
              ) : null}
            </ul>
            {user.role === "ADMIN" ? (
              <div className="mt-4 rounded-xl border border-dashed border-ink-700 bg-ink-800/30 p-4">
                <p className="mb-1 text-sm font-semibold text-gray-100">
                  Register internal SDK (private vendor)
                </p>
                <p className="mb-3 text-xs text-ink-400">
                  Private vendors are visible only inside your organization and can ingest change
                  events through their own agent key.
                </p>
                <PrivateVendorForm />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plan & billing</CardTitle>
          <CardDescription>
            Subscription tier, repository capacity, and Stripe billing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="blue">{plan.tier}</Badge>
            <span className="text-sm text-ink-300">
              {formatPrice(PLAN_DEFINITIONS[plan.tier].priceCents)}
              {plan.status === "ACTIVE" || plan.status === "PAST_DUE" ? (
                <>
                  {" · "}
                  <span className="text-xs text-ink-400">
                    {plan.status === "PAST_DUE" ? "payment past due" : "active"}
                    {plan.currentPeriodEnd ? ` · renews ${formatDate(plan.currentPeriodEnd)}` : ""}
                  </span>
                </>
              ) : null}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-ink-400">
              <span>
                Repository usage: {capacity.activeCount}
                {capacity.cap !== null ? ` of ${capacity.cap}` : " (unlimited)"}
              </span>
              {capacity.remaining !== null ? <span>{capacity.remaining} remaining</span> : null}
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-800 border border-ink-700">
              <div
                className={
                  capacity.remaining === 0 && capacity.cap !== null
                    ? "h-full rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                    : "h-full rounded-full bg-gradient-to-r from-accent-600 to-accent-400 shadow-[0_0_8px_rgba(99,102,241,0.6)]"
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
              <p className="mt-1 text-xs text-red-400 font-medium">
                Repository capacity reached — upgrade to connect more.
              </p>
            ) : null}
          </div>

          {!billingConfigured ? (
            <p className="text-xs text-ink-400">
              Billing is not configured for this deployment — every workspace stays on {plan.tier}.
              Set <code>STRIPE_SECRET_KEY</code> to enable checkout.
            </p>
          ) : (
            <BillingActions
              upgradeableTiers={upgradeableTiers}
              hasStripeCustomer={plan.stripeCustomerId !== null}
            />
          )}
        </CardContent>
      </Card>

      <Card>
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
            <div className="px-4 py-3 text-sm text-ink-400">
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
                      <TableCell className="text-sm font-medium text-gray-100">
                        {vendor?.name ?? gate.vendorSlug}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{gate.level}</TableCell>
                      <TableCell>
                        <StatusPill
                          label={gate.status.toLowerCase()}
                          tone={GATE_STATUS_TONE[gate.status]}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-ink-400">
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

      <Card>
        <CardHeader>
          <CardTitle>Local development notice</CardTitle>
          <CardDescription>Safety boundaries of this MVP.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-ink-300">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              Validation mode:{" "}
              <span className="font-mono text-gray-100">
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
              <span className="font-mono text-gray-100">
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
