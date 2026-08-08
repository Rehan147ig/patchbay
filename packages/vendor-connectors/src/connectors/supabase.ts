import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Supabase connector.
 *
 * Supabase JS v2 breaking changes vs v1:
 * - `supabase.from('t').select()` is unchanged, but the v1
 *   `postgrest-js` client filters (`.eq()`, `.single()`) return different
 *   shapes: v2 `select()` returns `{ data, error }` — the old
 *   `body` field was renamed.
 * - The auth API changed: `supabase.auth.signIn` became
 *   `signInWithPassword`/`signInWithOtp`/`signInWithOAuth`.
 * - Storage `upload`/`download` signatures changed in v2.
 */
export const supabaseConnector = defineConnector({
  slug: "supabase",
  identifiers: ["supabase", "@supabase/supabase-js", "postgrest-js"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "supabase.auth.signIn",
      newValue: "supabase.auth.signInWithPassword",
      description:
        "Supabase JS v2 split `signIn` into `signInWithPassword` (email+password), `signInWithOtp`, and `signInWithOAuth`.",
      affectedSymbols: ["supabase.auth.signIn", "supabase.auth.signUp"],
      breaking: true,
      evidence: { sdk: "supabase", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "RESPONSE_FIELD_REMOVED",
      oldValue: "response.body",
      newValue: "response.data",
      description:
        "Supabase JS v2 renamed the query result field from `body` to `data`; `{ data, error }` is the canonical response shape.",
      affectedSymbols: ["supabase.from", "postgrest"],
      breaking: true,
      evidence: { sdk: "supabase" },
    },
    {
      changeType: "PARAMETER_REQUIRED",
      oldValue: "storage.upload(path, file)",
      newValue: "storage.upload(path, file, { upsert })",
      description:
        "Supabase storage v2 requires an options object for `upload` (upsert, contentType); the legacy 2-arg call fails.",
      affectedSymbols: ["supabase.storage.upload", "storage.upload"],
      breaking: false,
      evidence: { sdk: "supabase" },
    },
  ],
  patchSuggestions: {
    "supabase.auth.signIn": {
      replacement: "supabase.auth.signInWithPassword",
      description:
        "Replace `supabase.auth.signIn({ email, password })` with `supabase.auth.signInWithPassword({ email, password })` (v2).",
      confidence: 95,
    },
    "supabase.auth.signUp": {
      replacement: "supabase.auth.signUp",
      description:
        "`signUp` now returns `{ data: { user, session }, error }` — update destructuring from `body` to `data`.",
      confidence: 85,
    },
  },
});
