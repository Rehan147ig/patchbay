/**
 * Blast radius for a remediation case (WP3). Pure and DB-free: risk tags,
 * affected usage count, ownership spread, certified connector capability and
 * validation profile determine a 0-100 score, a severity, and an explanation.
 * A connector is eligible for automated planning only when its certified
 * capability reaches PLAN; nothing else can raise that.
 */

export type BlastSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface BlastRadiusInput {
  /** RiskTag values carried by the affected usages / release facts. */
  riskTags: readonly string[];
  /** Distinct affected usage/integration call sites. */
  affectedUsageCount: number;
  /** Distinct owners of the affected usage. */
  ownerCount: number;
  /** Certified connector capability level (DETECT..DRAFT_PR). */
  capabilityLevel: string;
  /** Validation profile id; non-null only when sandbox validation exists. */
  validationProfile: string | null;
}

export interface BlastRadius {
  score: number;
  severity: BlastSeverity;
  factors: string[];
  /** True when capability >= PLAN, i.e. planning may consume model budget. */
  planEligible: boolean;
}

const RISK_TAG_WEIGHT: Record<string, number> = {
  PAYMENT: 15,
  AUTH: 12,
  SECRETS: 12,
  PII: 10,
  WEBHOOK: 8,
  ENCRYPTION: 10,
};

export function computeBlastRadius(input: BlastRadiusInput): BlastRadius {
  const factors: string[] = [];
  let score = 20;

  const tags = input.riskTags.filter((tag) => tag in RISK_TAG_WEIGHT);
  if (tags.length > 0) {
    score += Math.min(
      tags.reduce((sum, tag) => sum + RISK_TAG_WEIGHT[tag]!, 0),
      30,
    );
    factors.push(`risk tags: ${tags.join(", ")}`);
  }

  if (input.affectedUsageCount >= 10) {
    score += 15;
    factors.push(`${input.affectedUsageCount} affected usages`);
  } else if (input.affectedUsageCount >= 3) {
    score += 8;
    factors.push(`${input.affectedUsageCount} affected usages`);
  } else if (input.affectedUsageCount >= 1) {
    factors.push(`${input.affectedUsageCount} affected usage`);
  }

  if (input.ownerCount > 1) {
    score += 10;
    factors.push(`${input.ownerCount} owners`);
  }

  if (input.validationProfile) {
    score -= 5;
    factors.push(`validation profile: ${input.validationProfile}`);
  }

  const planEligible = isPlanEligibleLevel(input.capabilityLevel);
  if (!planEligible) {
    factors.push(`capability ${input.capabilityLevel}: no automated planning`);
  } else {
    factors.push(`capability ${input.capabilityLevel}`);
  }

  const bounded = Math.min(Math.max(score, 0), 100);
  const severity: BlastSeverity =
    bounded >= 75 ? "CRITICAL" : bounded >= 55 ? "HIGH" : bounded >= 35 ? "MEDIUM" : "LOW";

  return { score: bounded, severity, factors, planEligible };
}

/** Level ordering shared with the capability registry contract. */
const CAPABILITY_ORDER = ["DETECT", "ASSESS", "PLAN", "VALIDATE", "DRAFT_PR"];

export function isPlanEligibleLevel(level: string): boolean {
  return CAPABILITY_ORDER.indexOf(level) >= CAPABILITY_ORDER.indexOf("PLAN");
}
