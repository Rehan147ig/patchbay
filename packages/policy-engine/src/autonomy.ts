/**
 * Autonomous-track guardrails (Step 4: Renovate-style autonomy policy).
 *
 * Pure, DB-free evaluator: decides whether one autonomous semver bump may
 * proceed to a draft PR under the organization's AutonomyPolicy. Fails closed
 * on every ambiguity — excluded packages, concurrency cap, minimum release
 * age, and non-patch/minor kinds all hold the case at IMPACT_CONFIRMED with
 * an explicit reason. CVE fixes bypass the age wait when the policy allows
 * (security patches must not wait for the schedule).
 *
 * Draft PRs only, never auto-merge: this gate controls *proposal*, and human
 * approval stays mandatory downstream (APPROVAL_REQUIRED policy class).
 */

export type AutonomyUpdateType = "patch" | "minor" | "major" | "unknown";

export interface AutonomyPolicyShape {
  maxOpenAutonomousPRs: number;
  minimumReleaseAgeDays: number;
  groupMinorPatches: boolean;
  vulnBypassStability: boolean;
  excludedPackages: readonly string[];
}

export const AUTONOMY_POLICY_DEFAULTS: AutonomyPolicyShape = {
  maxOpenAutonomousPRs: 5,
  minimumReleaseAgeDays: 3,
  groupMinorPatches: true,
  vulnBypassStability: true,
  excludedPackages: [],
};

export interface AutonomyBumpInput {
  updateType: AutonomyUpdateType;
  packageName: string;
  /** Release publish time; null means unprovable age — fail closed. */
  publishedAt: Date | null;
  /** True when the bump fixes a known CVE (OSV provenance). */
  isVulnFix: boolean;
  /** Currently open autonomous-track cases in this org. */
  openAutonomousCases: number;
  policy: AutonomyPolicyShape;
  now?: Date;
}

export interface AutonomyDecision {
  ok: boolean;
  reasons: string[];
}

const MS_PER_DAY = 86_400_000;

export function evaluateAutonomyBump(input: AutonomyBumpInput): AutonomyDecision {
  const reasons: string[] = [];
  const { policy } = input;

  if (input.updateType !== "patch" && input.updateType !== "minor") {
    reasons.push(`autonomous track covers patch/minor bumps only (got ${input.updateType})`);
  }

  if (policy.excludedPackages.includes(input.packageName)) {
    reasons.push(`package ${input.packageName} is excluded from the autonomous track`);
  }

  if (input.openAutonomousCases >= policy.maxOpenAutonomousPRs) {
    reasons.push(
      `autonomous concurrency cap reached (${input.openAutonomousCases}/${policy.maxOpenAutonomousPRs} open)`,
    );
  }

  const bypassAge = input.isVulnFix && policy.vulnBypassStability;
  if (!bypassAge) {
    if (!input.publishedAt) {
      reasons.push("release publish date is unknown; minimum-age gate cannot be proven");
    } else {
      const now = input.now ?? new Date();
      const ageDays = (now.getTime() - input.publishedAt.getTime()) / MS_PER_DAY;
      if (ageDays < policy.minimumReleaseAgeDays) {
        reasons.push(
          `release is ${ageDays.toFixed(1)}d old, minimum is ${policy.minimumReleaseAgeDays}d`,
        );
      }
    }
  }

  return { ok: reasons.length === 0, reasons };
}
