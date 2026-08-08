import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Salesforce connector.
 *
 * Salesforce API versioning (release every quarter, breaking changes):
 * - REST API versioned (/services/data/vXX.0); older versions get
 *   deprecated and removed.
 * - OAuth2 flow / JWT bearer changes; `jsforce` client init changes.
 * - SOQL field/object renames break queries silently.
 */
export const salesforceConnector = defineConnector({
  slug: "salesforce",
  identifiers: ["salesforce", "jsforce", "@salesforce/*", "sfdx"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "OAuth2 / JWT bearer",
      description:
        "Salesforce OAuth/JWT bearer auth changed across releases (connected app, jwt-bearer flow).",
      affectedSymbols: ["jsforce", "Connection", "oauth2"],
      breaking: true,
      evidence: { sdk: "salesforce", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "API version deprecation",
      description:
        "Salesforce deprecates REST API versions quarterly; pinned old versions stop working.",
      affectedSymbols: ["/services/data/v", "jsforce.query", "connection.query"],
      breaking: true,
      evidence: { sdk: "salesforce" },
    },
    {
      changeType: "OTHER",
      oldValue: "SOQL object/field renames",
      description:
        "SOQL queries break when objects/fields are renamed; queries need explicit review per release.",
      affectedSymbols: ["query", "soql"],
      breaking: false,
      evidence: { sdk: "salesforce" },
    },
  ],
  patchSuggestions: {
    jsforce: {
      replacement: "jsforce (current API version)",
      description: "Update jsforce/Connection to the current API version and OAuth2 config.",
      confidence: 75,
    },
  },
});
