import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import {
  createStripeClient,
  formatPrice,
  PLAN_DEFINITIONS,
  repositoryCapacity,
  stripePriceIdForTier,
} from "@patchbay/billing";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@patchbay/ui";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { getEffectivePlan } from "@/lib/billing";
import { BillingActions } from "@/components/billing-actions";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const user = await requireUser();
  const [organization, vendors, plan, activeRepositories] = await Promise.all([
    prisma.organization.findUnique({ where: { id: user.organizationId } }),
    prisma.vendor.findMany({ orderBy: { name: "asc" } }),
    getEffectivePlan(user.organizationId),
    prisma.repository.count({ where: { organizationId: user.organizationId, status: "ACTIVE" } }),
  ]);

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
            <ul className="divide-y divide-slate-100">
              {vendors.map((vendor) => (
                <li key={vendor.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{vendor.name}</p>
                    <p className="text-xs text-slate-500">
                      {vendor.category}
                      {vendor.docsUrl ? " · " + vendor.docsUrl : ""}
                    </p>
                  </div>
                  <Badge tone={vendor.enabled ? "green" : "neutral"}>
                    {vendor.enabled ? "enabled" : "disabled"}
                  </Badge>
                </li>
              ))}
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
