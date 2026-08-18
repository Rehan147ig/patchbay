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
import { BillingActions } from "@/components/billing-actions";
import { CapabilityGateControl } from "@/components/capability-gate-control";
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
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
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
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Workspace and integration configuration.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Organization profile (demo).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-slate-800">{organization?.name ?? "—"}</p>
            <p className="text-xs text-slate-500">
              You are signed in as <span className="font-medium">{user.email}</span> with role{" "}
              <Badge tone={user.role === "ADMIN" ? "purple" : "blue"}>{user.role}</Badge>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monitored vendors</CardTitle>
            <CardDescription>
              Vendor catalog entries available for change monitoring.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="get" className="mb-3 flex items-center gap-2">
              <label htmlFor="capability-filter" className="text-xs text-slate-500">
                Certified capability
              </label>
              <select
                id="capability-filter"
                name="capability"
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
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
                className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white"
              >
                Filter
              </button>
            </form>
            <ul className="divide-y divide-slate-100">
              {visibleVendors.map((vendor) => {
                const capability = getCapability(vendor.slug);
                return (
                  <li key={vendor.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{vendor.name}</p>
                      <p className="text-xs text-slate-500">
                        {vendor.category}
                        {vendor.docsUrl ? " · " + vendor.docsUrl : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {capability ? (
                        <>
                          <Badge tone={CAPABILITY_BADGE_TONE[capability.level]}>
                            {capability.level}
                            {capability.certifiedAt !== null ? " · certified" : ""}
                          </Badge>
                          <span className="text-xs text-slate-400">{capability.language}</span>
                        </>
                      ) : null}
                      <Badge tone={vendor.enabled ? "green" : "neutral"}>
                        {vendor.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                  </li>
                );
              })}
              {visibleVendors.length === 0 ? (
                <li className="py-2 text-sm text-slate-500">No vendors certified at this level.</li>
              ) : null}
            </ul>
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
            <span className="text-sm text-slate-600">
              {formatPrice(PLAN_DEFINITIONS[plan.tier].priceCents)}
              {plan.status === "ACTIVE" || plan.status === "PAST_DUE" ? (
                <>
                  {" · "}
                  <span className="text-xs text-slate-500">
                    {plan.status === "PAST_DUE" ? "payment past due" : "active"}
                    {plan.currentPeriodEnd ? ` · renews ${formatDate(plan.currentPeriodEnd)}` : ""}
                  </span>
                </>
              ) : null}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Repository usage: {capacity.activeCount}
                {capacity.cap !== null ? ` of ${capacity.cap}` : " (unlimited)"}
              </span>
              {capacity.remaining !== null ? <span>{capacity.remaining} remaining</span> : null}
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={
                  capacity.remaining === 0 && capacity.cap !== null
                    ? "h-full rounded-full bg-red-500"
                    : "h-full rounded-full bg-slate-900"
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
              <p className="mt-1 text-xs text-red-600">
                Repository capacity reached — upgrade to connect more.
              </p>
            ) : null}
          </div>

          {!billingConfigured ? (
            <p className="text-xs text-slate-500">
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
            <div className="px-4 py-3 text-sm text-slate-500">
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
                      <TableCell className="text-sm font-medium text-slate-800">
                        {vendor?.name ?? gate.vendorSlug}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{gate.level}</TableCell>
                      <TableCell>
                        <StatusPill
                          label={gate.status.toLowerCase()}
                          tone={GATE_STATUS_TONE[gate.status]}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
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
        <CardContent className="text-sm text-slate-600">
          <ul className="list-disc space-y-1 pl-4">
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
