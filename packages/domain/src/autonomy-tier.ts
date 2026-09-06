import { z } from "zod";

/**
 * Organization default delivery autonomy tier (WP12).
 *
 * - PLAN_ONLY: generate plans and blast radius only; PR delivery is refused
 *   everywhere (worker-enforced, fail closed).
 * - REQUIRE_APPROVAL: plans + sandbox validation run, but a draft PR requires
 *   a covering approval on record (worker-enforced).
 * - ALLOW_DRAFT_PR: validated draft PRs deliver automatically (existing
 *   certification/gate/policy/approval behavior, unchanged).
 *
 * Null (unset) = legacy behavior: no tier enforcement. The onboarding wizard
 * always sets an explicit tier for new organizations.
 */
export const autonomyTierSchema = z.enum(["PLAN_ONLY", "REQUIRE_APPROVAL", "ALLOW_DRAFT_PR"]);
export type AutonomyTier = z.infer<typeof autonomyTierSchema>;

/** Recommended default for new organizations (explicit, never silent). */
export const DEFAULT_AUTONOMY_TIER: AutonomyTier = "REQUIRE_APPROVAL";
