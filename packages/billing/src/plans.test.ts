import { describe, expect, it } from "vitest";
import {
  defaultPlanTier,
  formatPrice,
  isPlanTier,
  planLabel,
  planTierFromStripePriceId,
  PLAN_DEFINITIONS,
  PURCHASABLE_TIERS,
  repositoryCapForTier,
  repositoryCapacity,
  stripePriceIdForTier,
} from "./plans";

describe("PLAN_DEFINITIONS", () => {
  it("defines the four tiers with the documented repo caps and pricing", () => {
    expect(PLAN_DEFINITIONS.FREE.repositoryCap).toBe(1);
    expect(PLAN_DEFINITIONS.FREE.priceCents).toBe(0);
    expect(PLAN_DEFINITIONS.PRO.repositoryCap).toBe(10);
    expect(PLAN_DEFINITIONS.PRO.priceCents).toBe(14900);
    expect(PLAN_DEFINITIONS.TEAM.repositoryCap).toBe(50);
    expect(PLAN_DEFINITIONS.TEAM.priceCents).toBe(49900);
    expect(PLAN_DEFINITIONS.ENTERPRISE.repositoryCap).toBeNull();
    expect(PLAN_DEFINITIONS.ENTERPRISE.priceCents).toBeNull();
  });

  it("exposes PRO and TEAM as the only self-serve purchasable tiers", () => {
    expect(PURCHASABLE_TIERS).toEqual(["PRO", "TEAM"]);
  });
});

describe("repositoryCapacity", () => {
  it("allows registration below the cap and reports the remaining headroom", () => {
    const result = repositoryCapacity("PRO", 4);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(6);
  });

  it("blocks registration at the cap", () => {
    const result = repositoryCapacity("PRO", 10);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows exactly one repo on the free tier", () => {
    expect(repositoryCapacity("FREE", 0).allowed).toBe(true);
    expect(repositoryCapacity("FREE", 1).allowed).toBe(false);
  });

  it("never blocks the enterprise tier", () => {
    expect(repositoryCapacity("ENTERPRISE", 10_000).allowed).toBe(true);
    expect(repositoryCapacity("ENTERPRISE", 10_000).cap).toBeNull();
  });
});

describe("plan helpers", () => {
  it("maps Stripe price ids to tiers from env", () => {
    const env = {
      STRIPE_PRICE_PRO_MONTHLY: "price_pro",
      STRIPE_PRICE_TEAM_MONTHLY: "price_team",
    } as NodeJS.ProcessEnv;
    expect(planTierFromStripePriceId("price_pro", env)).toBe("PRO");
    expect(planTierFromStripePriceId("price_team", env)).toBe("TEAM");
    expect(planTierFromStripePriceId("price_unknown", env)).toBeNull();
    expect(planTierFromStripePriceId("price_pro", {})).toBeNull();
  });

  it("resolves price ids for purchasable tiers only", () => {
    const env = {
      STRIPE_PRICE_PRO_MONTHLY: "price_pro",
      STRIPE_PRICE_TEAM_MONTHLY: "price_team",
    } as NodeJS.ProcessEnv;
    expect(stripePriceIdForTier("PRO", env)).toBe("price_pro");
    expect(stripePriceIdForTier("TEAM", env)).toBe("price_team");
    expect(stripePriceIdForTier("FREE", env)).toBeNull();
    expect(stripePriceIdForTier("ENTERPRISE", env)).toBeNull();
    expect(stripePriceIdForTier("PRO", {})).toBeNull();
  });

  it("formats prices and labels", () => {
    expect(formatPrice(0)).toBe("$0");
    expect(formatPrice(14900)).toBe("$149/mo");
    expect(formatPrice(null)).toBe("Custom");
    expect(planLabel("PRO")).toBe("Pro");
    expect(defaultPlanTier()).toBe("FREE");
  });

  it("guards tier values", () => {
    expect(isPlanTier("FREE")).toBe(true);
    expect(isPlanTier("ENTERPRISE")).toBe(true);
    expect(isPlanTier("ULTRA")).toBe(false);
    expect(isPlanTier(null)).toBe(false);
  });

  it("keeps caps consistent with the tier definitions", () => {
    expect(repositoryCapForTier("FREE")).toBe(PLAN_DEFINITIONS.FREE.repositoryCap);
    expect(repositoryCapForTier("TEAM")).toBe(50);
  });
});
