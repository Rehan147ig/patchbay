import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Okta connector.
 *
 * Okta SDK breaking changes:
 * - `@okta/okta-auth-js` majors changed the session/token API
 *   (tokenManager, signIn flow).
 * - The management SDK (`@okta/okta-sdk-nodejs`) renamed client methods
 *   across majors.
 * - OIDC library migration: `@okta/oidc-middleware` deprecated in favor of
 *   direct OIDC / Auth.js style integration.
 */
export const oktaConnector = defineConnector({
  slug: "okta",
  identifiers: ["okta", "@okta/*", "okta-sdk"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "tokenManager",
      description:
        "@okta/okta-auth-js changed the token/session API across majors (tokenManager storage, signIn flow).",
      affectedSymbols: ["tokenManager", "signIn", "authClient"],
      breaking: true,
      evidence: { sdk: "okta", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "@okta/oidc-middleware",
      description:
        "@okta/oidc-middleware is deprecated; migrate to direct OIDC (Auth.js, Passport, or Okta's newer SDK).",
      affectedSymbols: ["oidc-middleware", "OIDCMiddleware"],
      breaking: true,
      evidence: { sdk: "okta", riskTag: RiskTag.AUTH },
    },
  ],
  patchSuggestions: {
    tokenManager: {
      replacement: "tokenManager (v7)",
      description:
        "Update tokenManager usage to the current @okta/okta-auth-js API (storage options, token shape).",
      confidence: 80,
    },
  },
});
