import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * NextAuth / Auth.js connector.
 *
 * Auth.js v4 -> v5 is a ground-up rewrite:
 * - v4 `getServerSession`/`withAuth` middleware -> v5 `auth()` helper
 *   (or `auth` export for middleware).
 * - Config surface: `NextAuthOptions` -> `NextAuthConfig`; providers
 *   moved to `@auth/core/providers` / `next-auth/providers` restructured.
 * - Callbacks (`jwt`, `session`, `signIn`) signatures changed.
 * - `NEXTAUTH_SECRET` -> `AUTH_SECRET` env rename.
 */
export const nextAuthConnector = defineConnector({
  slug: "next-auth",
  identifiers: ["next-auth", "@auth/core", "@auth/nextjs", "auth.js"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "getServerSession",
      newValue: "auth()",
      description:
        "Auth.js v5 replaced getServerSession with the auth() helper (from @auth/nextjs).",
      affectedSymbols: ["getServerSession", "withAuth", "unstable_getServerSession"],
      breaking: true,
      evidence: { sdk: "next-auth", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "PARAMETER_RENAMED",
      oldValue: "NextAuthOptions",
      newValue: "NextAuthConfig",
      description:
        "v5 renamed the config type and moved providers to @auth/core/providers; callback signatures changed.",
      affectedSymbols: ["NextAuthOptions", "NextAuthConfig", "authOptions"],
      breaking: true,
      evidence: { sdk: "next-auth", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "PARAMETER_RENAMED",
      oldValue: "NEXTAUTH_SECRET",
      newValue: "AUTH_SECRET",
      description: "v5 renamed the NEXTAUTH_SECRET env var to AUTH_SECRET.",
      affectedSymbols: ["process.env.NEXTAUTH_SECRET", "NEXTAUTH_SECRET"],
      breaking: true,
      evidence: { sdk: "next-auth", riskTag: RiskTag.AUTH },
    },
  ],
  patchSuggestions: {
    getServerSession: {
      replacement: "auth()",
      description:
        "Replace getServerSession(req, res, authOptions) with await auth() from @auth/nextjs (v5).",
      confidence: 90,
    },
    unstable_getServerSession: {
      replacement: "auth()",
      description: "Replace unstable_getServerSession with the v5 auth() helper.",
      confidence: 90,
    },
    NextAuthOptions: {
      replacement: "NextAuthConfig",
      description: "Rename NextAuthOptions type to NextAuthConfig and update provider imports.",
      confidence: 85,
    },
  },
});
