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
  /** Hex-encoded HMAC/signature over the canonical JSON of the recipe (without this field). */
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
