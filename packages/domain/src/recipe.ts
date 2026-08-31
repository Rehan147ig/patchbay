import { z } from "zod";

/**
 * Versioned migration recipe served by the public registry.
 * Derived from certified @patchbay/vendor-connectors rule packs; never contains code.
 */

export const recipeRuleSchema = z.object({
  changeType: z.string().min(1).max(100),
  oldValue: z.string().max(500).nullable(),
  newValue: z.string().max(500).nullable(),
  description: z.string().max(1000).nullable(),
  trusted: z.boolean().default(true),
});
export type RecipeRule = z.infer<typeof recipeRuleSchema>;

export const migrationRecipeSchema = z.object({
  schemaVersion: z.literal(1),
  vendor: z.string().min(1).max(100),
  fromVersion: z.string().min(1).max(50),
  toVersion: z.string().min(1).max(50),
  capability: z.enum(["DRAFT_PR", "PLAN"]),
  certifiedAt: z.string().datetime().nullable(),
  engineVersion: z.string().min(1).max(50),
  rules: z.array(recipeRuleSchema).min(1).max(100),
  /** Identifier of the signing key that produced `signature` — explicit versioning for rotation. Omitted on legacy recipes (verified via dual-key trial). */
  keyId: z.string().min(1).max(64).optional(),
  /** Signature version — increment when HMAC scheme changes. Currently 1 = HMAC-SHA256 over canonical JSON. */
  signatureVersion: z.literal(1).optional().default(1),
  /** HMAC-SHA256 over canonical JSON (without this field), signed by Patch platform key. Verified in @patchbay/cli before --write; fails closed to PLAN preview. */
  signature: z.string().regex(/^[0-9a-f]{64,128}$/),
});
export type MigrationRecipe = z.infer<typeof migrationRecipeSchema>;

export const recipeListEntrySchema = z.object({
  vendor: z.string().min(1).max(100),
  fromVersion: z.string().min(1).max(50),
  toVersion: z.string().min(1).max(50),
  capability: z.enum(["DRAFT_PR", "PLAN"]),
  certifiedAt: z.string().datetime().nullable(),
});
export type RecipeListEntry = z.infer<typeof recipeListEntrySchema>;
