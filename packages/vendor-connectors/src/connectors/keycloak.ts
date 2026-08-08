import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Keycloak connector.
 *
 * Keycloak admin client / adapter changes:
 * - `keycloak-js` adapter init changed (init options, pkce required by
 *   default in newer versions).
 * - The admin REST API versions endpoints (admin/realms/{realm}/users
 *   etc.); response field renames across Keycloak majors.
 * - `@keycloak/keycloak-admin-client` renamed methods.
 */
export const keycloakConnector = defineConnector({
  slug: "keycloak",
  identifiers: ["keycloak", "keycloak-js", "@keycloak/keycloak-admin-client"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "keycloak.init()",
      description:
        "keycloak-js init changed across versions: pkce is now required by default, flow/redirect options changed.",
      affectedSymbols: ["keycloak.init", "Keycloak"],
      breaking: true,
      evidence: { sdk: "keycloak", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "admin client methods",
      description:
        "@keycloak/keycloak-admin-client renamed user/realm/group methods across majors.",
      affectedSymbols: ["keycloak-admin-client", "adminClient.users"],
      breaking: true,
      evidence: { sdk: "keycloak" },
    },
  ],
  patchSuggestions: {
    "keycloak.init": {
      replacement: "keycloak.init (pkce)",
      description:
        "Update keycloak-js init to the current options (enable pkce, update flow/redirect handling).",
      confidence: 80,
    },
  },
});
