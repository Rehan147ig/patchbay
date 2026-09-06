import { ValidationStatus } from "@patchbay/domain";
import { deliveryQuotaForTier } from "@patchbay/billing";
import type { PlanTier } from "@patchbay/domain";

/**
 * Server-side delivery quota enforcement (WP11, spec §16).
 *
 * Plan caps mean nothing if only the web registration path checks them: a
 * direct-enqueue or a retry storm would sail past. This module counts
 * current-calendar-month (UTC) usage per organization and blocks over-quota
 * delivery with a predictable, auditable refusal — never a silent drop.
 * SKIPPED validations consume nothing (customer CI did the work).
 *
 * Structural PrismaLike keeps this DB-free and unit-testable; web and worker
 * share it, differing only in how they surface the refusal (402 vs
 * UnrecoverableError).
 */

export type DeliveryQuotaKind = "VALIDATE" | "DRAFT_PR";

export interface DeliveryQuotaPrisma {
  subscription: {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  };
  pullRequest: {
    count(args: unknown): Promise<number>;
  };
  validationRun: {
    count(args: unknown): Promise<number>;
  };
}

export interface DeliveryQuotaResult {
  allowed: boolean;
  tier: PlanTier;
  kind: DeliveryQuotaKind;
  quota: number | null;
  used: number;
  remaining: number | null;
  periodStart: Date;
}

/** First instant of the UTC calendar month containing `now`. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** ACTIVE/PAST_DUE subscriptions grant their tier; everything else is FREE. */
export function effectiveQuotaTier(subscription: { status: unknown; planTier: unknown }): PlanTier {
  if (
    (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") &&
    typeof subscription.planTier === "string"
  ) {
    return subscription.planTier as PlanTier;
  }
  return "FREE";
}

export async function checkDeliveryQuota(
  prisma: DeliveryQuotaPrisma,
  input: { organizationId: string; kind: DeliveryQuotaKind; now?: Date },
): Promise<DeliveryQuotaResult> {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: input.organizationId },
  });
  const tier = effectiveQuotaTier({
    status: subscription?.status,
    planTier: subscription?.planTier,
  });
  const quota = deliveryQuotaForTier(tier, input.kind);
  const periodStart = monthStartUtc(input.now);
  if (quota === null) {
    return {
      allowed: true,
      tier,
      kind: input.kind,
      quota: null,
      used: 0,
      remaining: null,
      periodStart,
    };
  }
  const used =
    input.kind === "DRAFT_PR"
      ? await prisma.pullRequest.count({
          where: { organizationId: input.organizationId, createdAt: { gte: periodStart } },
        })
      : await prisma.validationRun.count({
          where: {
            organizationId: input.organizationId,
            createdAt: { gte: periodStart },
            status: { not: ValidationStatus.SKIPPED },
          },
        });
  return {
    allowed: used < quota,
    tier,
    kind: input.kind,
    quota,
    used,
    remaining: Math.max(0, quota - used),
    periodStart,
  };
}

/** Predictable refusal message shared by the web 402 and worker terminal error. */
export function quotaBlockedMessage(result: DeliveryQuotaResult): string {
  const unit = result.kind === "DRAFT_PR" ? "draft PRs" : "validations";
  return (
    `Monthly ${unit} quota exceeded for the ${result.tier} plan ` +
    `(${result.used}/${result.quota} used since ${result.periodStart.toISOString().slice(0, 10)}). ` +
    `Upgrade or wait for the next calendar month; nothing was executed and nothing was dropped silently.`
  );
}
