import "server-only";
import { prisma, type Subscription } from "@patchbay/db";
import { StripeClient, createStripeClient } from "@patchbay/billing";
import type { PlanTier } from "@patchbay/domain";
import { billingUnavailable, notFound, planLimitExceeded } from "@patchbay/domain";
import { env } from "./env";

/**
 * Billing plumbing shared by the /api/billing routes and the repository
 * registration cap. Organizations without a Subscription row default to the
 * FREE tier; canceled or trialing rows do not grant paid capacity.
 */
export interface EffectivePlan {
  tier: PlanTier;
  status: Subscription["status"] | null;
  currentPeriodEnd: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export function effectiveTier(subscription: Subscription | null): PlanTier {
  if (!subscription) return "FREE";
  if (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") {
    return subscription.planTier;
  }
  return "FREE";
}

export async function getOrganizationSubscription(
  organizationId: string,
): Promise<Subscription | null> {
  return prisma.subscription.findUnique({ where: { organizationId } });
}

export async function getEffectivePlan(organizationId: string): Promise<EffectivePlan> {
  const subscription = await getOrganizationSubscription(organizationId);
  return {
    tier: effectiveTier(subscription),
    status: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    stripeCustomerId: subscription?.stripeCustomerId ?? null,
    stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
  };
}

/** Stripe client or a 503 for deployments without billing configured. */
export function requireStripeClient(): StripeClient {
  const client = createStripeClient(env);
  if (!client) throw billingUnavailable();
  return client;
}

export async function requireStripeCustomerId(organizationId: string): Promise<string> {
  const subscription = await getOrganizationSubscription(organizationId);
  if (!subscription?.stripeCustomerId) {
    throw notFound("No Stripe customer exists for this organization yet");
  }
  return subscription.stripeCustomerId;
}

export interface RepoCapResult {
  allowed: boolean;
  tier: PlanTier;
  cap: number | null;
  activeCount: number;
  remaining: number | null;
}

/**
 * Enforces the active-repository cap for the organization's effective plan.
 * Throws a 402 PLAN_LIMIT_EXCEEDED when registration would exceed the cap.
 */
export async function assertRepositoryCapacity(
  organizationId: string,
  activeCount: number,
): Promise<RepoCapResult> {
  const plan = await getEffectivePlan(organizationId);
  const { repositoryCapacity } = await import("@patchbay/billing");
  const capacity = repositoryCapacity(plan.tier, activeCount);
  if (!capacity.allowed) {
    throw planLimitExceeded(
      `Your ${plan.tier} plan allows up to ${capacity.cap} active repositories (${activeCount} in use). Upgrade to connect more.`,
      { tier: plan.tier, cap: capacity.cap, activeCount: capacity.activeCount },
    );
  }
  return { ...capacity, tier: plan.tier };
}

export async function countActiveRepositories(organizationId: string): Promise<number> {
  return prisma.repository.count({
    where: { organizationId, status: "ACTIVE" },
  });
}
