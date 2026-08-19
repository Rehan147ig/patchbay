import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

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
