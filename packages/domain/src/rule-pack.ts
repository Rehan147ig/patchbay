import { z } from "zod";
import { ChangeType, RiskTag } from "./enums";
import { ContractKind } from "./capability-matrix";

/**
 * Versioned deterministic rule-pack declaration (Production Spec WP6 §7.1).
 *
 * A rule pack is the contract a certified connector makes: which changes it
 * handles, how much it may edit, what evidence it requires, how its output
 * is validated, which risks it can touch, and how to undo it. The engine
 * enforces edit budgets at plan time; evidence bindings, validation profiles,
 * and rollback instructions are declarative in WP6 (consumed by policy, UI,
 * and the corpus) and become engine-enforced as orchestration supplies
 * source-hash-bound inputs in WP7.
 */

export const editBudgetSchema = z.object({
  /** Maximum files touched by one plan. Must not exceed the global breaker cap. */
  maxFiles: z.number().int().positive().max(40),
  /** Maximum edits applied to a single file. */
  maxEditsPerFile: z.number().int().positive().max(20),
  /** Maximum patched bytes across the whole plan. */
  maxTotalBytes: z.number().int().positive().max(100_000),
});
export type EditBudget = z.infer<typeof editBudgetSchema>;

export const expectedEvidenceSchema = z.object({
  /** Every applied edit must be anchored on a source-hash-bound usage. */
  requiresSourceHash: z.boolean(),
  /** The dependency must resolve to a lockfile-pinned version. */
  requiresLockfileVersion: z.boolean(),
  /** Minimum affected usages before the pack engages (0 = any). */
  minUsages: z.number().int().min(0).max(1000),
});
export type ExpectedEvidence = z.infer<typeof expectedEvidenceSchema>;

export const rollbackSchema = z.object({
  strategy: z.enum(["revert-commit", "restore-branch", "manual"]),
  instructions: z.string().min(1).max(2000),
});
export type RollbackPlan = z.infer<typeof rollbackSchema>;

export const rulePackSchema = z.object({
  /** Pack identity, convention "<name>/<semver>" mirroring the capability registry. */
  packVersion: z.string().min(1).max(100),
  vendorSlug: z.string().min(1).max(100),
  contractKind: z.nativeEnum(ContractKind),
  supportedChanges: z.array(z.nativeEnum(ChangeType)).min(1).max(50),
  editBudget: editBudgetSchema,
  expectedEvidence: expectedEvidenceSchema,
  /** Sandbox validation profile id the kit was certified under. */
  validationProfile: z.string().min(1).max(200),
  riskTags: z.array(z.nativeEnum(RiskTag)).max(10),
  rollback: rollbackSchema,
});
export type RulePack = z.infer<typeof rulePackSchema>;

export function parseRulePack(input: unknown): RulePack {
  return rulePackSchema.parse(input);
}
