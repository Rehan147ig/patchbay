import type { PlanTier } from "@patchbay/domain";
import { PlanTier as PlanTierEnum } from "@patchbay/domain";

/**
 * Subscription tier definitions (single source of truth for pricing and
 * capacity). Prices are monthly, in USD cents. ENTERPRISE is custom-priced
 * and uncapped. Repo caps are enforced at repository registration time in
 * the web API routes.
 */
export interface PlanDefinition {
  tier: PlanTier;
  label: string;
  /** Monthly price in USD cents; null = custom/quote only. */
  priceCents: number | null;
  /** Active-repository cap; null = unlimited. */
  repositoryCap: number | null;
  /** Validations executed per calendar month (UTC); null = unlimited. */
  monthlyValidations: number | null;
  /** Draft PRs delivered per calendar month (UTC); null = unlimited. */
  monthlyDraftPRs: number | null;
  /** Stripe price id for checkout, resolved from env; null = not purchasable. */
  stripePriceId: string | null;
}

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  FREE: {
    tier: "FREE",
    label: "Free",
    priceCents: 0,
    repositoryCap: 1,
    monthlyValidations: 50,
    monthlyDraftPRs: 10,
    stripePriceId: null,
  },
  PRO: {
    tier: "PRO",
    label: "Pro",
    priceCents: 14900,
    repositoryCap: 10,
    monthlyValidations: 1000,
    monthlyDraftPRs: 200,
    stripePriceId: null,
  },
  TEAM: {
    tier: "TEAM",
    label: "Team",
    priceCents: 49900,
    repositoryCap: 50,
    monthlyValidations: 5000,
    monthlyDraftPRs: 1000,
    stripePriceId: null,
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    label: "Enterprise",
    priceCents: null,
    repositoryCap: null,
    monthlyValidations: null,
    monthlyDraftPRs: null,
    stripePriceId: null,
  },
};

export const PURCHASABLE_TIERS: readonly PlanTier[] = ["PRO", "TEAM"] as const;

/** The subset of process env the billing package reads (kept optional). */
export interface BillingEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_PRO_MONTHLY?: string;
  STRIPE_PRICE_TEAM_MONTHLY?: string;
  DODO_PAYMENTS_API_KEY?: string;
  DODO_PAYMENTS_ENVIRONMENT?: string;
  DODO_PAYMENTS_WEBHOOK_KEY?: string;
  DODO_PRODUCT_PRO_MONTHLY?: string;
  DODO_PRODUCT_TEAM_MONTHLY?: string;
}

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && value in PLAN_DEFINITIONS;
}

export function planTierFromStripePriceId(
  priceId: string,
  env: BillingEnv = process.env as BillingEnv,
): PlanTier | null {
  if (env.STRIPE_PRICE_PRO_MONTHLY && priceId === env.STRIPE_PRICE_PRO_MONTHLY) return "PRO";
  if (env.STRIPE_PRICE_TEAM_MONTHLY && priceId === env.STRIPE_PRICE_TEAM_MONTHLY) return "TEAM";
  return null;
}

/** Stripe price id for a purchasable tier; null when the tier has no price configured. */
export function stripePriceIdForTier(
  tier: PlanTier,
  env: BillingEnv = process.env as BillingEnv,
): string | null {
  if (tier === "PRO") return env.STRIPE_PRICE_PRO_MONTHLY ?? null;
  if (tier === "TEAM") return env.STRIPE_PRICE_TEAM_MONTHLY ?? null;
  return null;
}

/** Dodo product id for a purchasable tier; null when not configured. */
export function dodoProductIdForTier(
  tier: PlanTier,
  env: BillingEnv = process.env as BillingEnv,
): string | null {
  if (tier === "PRO") return env.DODO_PRODUCT_PRO_MONTHLY ?? null;
  if (tier === "TEAM") return env.DODO_PRODUCT_TEAM_MONTHLY ?? null;
  return null;
}

export function planTierFromDodoProductId(
  productId: string,
  env: BillingEnv = process.env as BillingEnv,
): PlanTier | null {
  if (env.DODO_PRODUCT_PRO_MONTHLY && productId === env.DODO_PRODUCT_PRO_MONTHLY) return "PRO";
  if (env.DODO_PRODUCT_TEAM_MONTHLY && productId === env.DODO_PRODUCT_TEAM_MONTHLY) return "TEAM";
  return null;
}

export function repositoryCapForTier(tier: PlanTier): number | null {
  return PLAN_DEFINITIONS[tier]?.repositoryCap ?? null;
}

/** Monthly delivery quota for a tier + kind; null = unlimited. */
export function deliveryQuotaForTier(tier: PlanTier, kind: "VALIDATE" | "DRAFT_PR"): number | null {
  const definition = PLAN_DEFINITIONS[tier];
  if (!definition) return null;
  return kind === "VALIDATE" ? definition.monthlyValidations : definition.monthlyDraftPRs;
}

export function planLabel(tier: PlanTier): string {
  return PLAN_DEFINITIONS[tier]?.label ?? tier;
}

export function formatPrice(priceCents: number | null): string {
  if (priceCents === null) return "Custom";
  if (priceCents === 0) return "$0";
  return `$${(priceCents / 100).toFixed(0)}/mo`;
}

export interface RepositoryCapacityResult {
  allowed: boolean;
  tier: PlanTier;
  cap: number | null;
  activeCount: number;
  remaining: number | null;
}

/**
 * Whether an organization with `activeCount` ACTIVE repositories may register
 * one more under its plan. ENTERPRISE is unlimited.
 */
export function repositoryCapacity(tier: PlanTier, activeCount: number): RepositoryCapacityResult {
  const cap = repositoryCapForTier(tier);
  if (cap === null) {
    return { allowed: true, tier, cap: null, activeCount, remaining: null };
  }
  return {
    allowed: activeCount < cap,
    tier,
    cap,
    activeCount,
    remaining: Math.max(0, cap - activeCount),
  };
}

export function defaultPlanTier(): PlanTier {
  return PlanTierEnum.FREE;
}
