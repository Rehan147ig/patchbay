import { defineConnector } from "../sdk";
import { RiskTag, type RulePack } from "@patchbay/domain";

/**
 * Supabase JS v1 → v2 connector (certified DRAFT_PR).
 *
 * Certified pattern: `supabase.auth.user()` → `supabase.auth.getUser()`.
 * Auth call sites are approval-gated (AUTH). signIn splits and PostgREST `body`
 * → `data` are not part of this certified kit.
 */
export const supabaseConnector = defineConnector({
  slug: "supabase",
  identifiers: ["supabase", "@supabase/supabase-js", "postgrest-js"],
  /** WP6 rule-pack declaration (see openai.ts for the contract semantics). */
  rulePack: {
    packVersion: "1.0.0",
    vendorSlug: "supabase",
    contractKind: "SDK",
    supportedChanges: ["METHOD_RENAMED"],
    editBudget: { maxFiles: 10, maxEditsPerFile: 10, maxTotalBytes: 50_000 },
    expectedEvidence: { requiresSourceHash: true, requiresLockfileVersion: true, minUsages: 1 },
    validationProfile: "node-ts-reparse + container-sandbox",
    riskTags: [],
    rollback: {
      strategy: "revert-commit",
      instructions: "Revert the Patchbay draft PR branch before merge.",
    },
  } satisfies RulePack,
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "supabase.auth.user",
      newValue: "supabase.auth.getUser",
      description:
        "Supabase JS v2 replaced the sync `auth.user()` helper with async `auth.getUser()`.",
      affectedSymbols: ["supabase.auth.user"],
      breaking: true,
      evidence: { sdk: "supabase", riskTag: RiskTag.AUTH, rule: "auth-user-to-getUser" },
    },
  ],
  patchSuggestions: {
    "supabase.auth.user": {
      replacement: "supabase.auth.getUser",
      description: "Rename supabase.auth.user to supabase.auth.getUser (Supabase JS v2).",
      confidence: 94,
    },
  },
});
