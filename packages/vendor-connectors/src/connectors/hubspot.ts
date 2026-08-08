import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * HubSpot connector.
 *
 * HubSpot API versioning + OAuth changes:
 * - OAuth2 scopes enforced; missing scopes now fail with 403.
 * - API versions deprecate (crm/v3 objects change, associations API
 *   changed to a new endpoint).
 * - Webhook subscription payloads changed (event types, signature
 *   verification headers x-hubspot-signature).
 */
export const hubspotConnector = defineConnector({
  slug: "hubspot",
  identifiers: ["hubspot", "@hubspot/api-client", "hubspot-api"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "OAuth scopes",
      description: "HubSpot enforces OAuth scopes; calls without the required scope now 403.",
      affectedSymbols: ["@hubspot/api-client", "hubspotClient"],
      breaking: true,
      evidence: { sdk: "hubspot", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "webhook payload",
      description:
        "Webhook payloads/event types changed and signature verification headers were added.",
      affectedSymbols: ["hubspot.webhooks", "webhooks"],
      breaking: true,
      evidence: { sdk: "hubspot", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "deprecated API versions",
      description:
        "HubSpot deprecates API versions; old object/association endpoints stop working.",
      affectedSymbols: ["crm.contacts", "crm.companies", "crm.associations"],
      breaking: true,
      evidence: { sdk: "hubspot" },
    },
  ],
  patchSuggestions: {
    "@hubspot/api-client": {
      replacement: "@hubspot/api-client (current version)",
      description:
        "Update the hubspot client to the current API version and add the required OAuth scopes.",
      confidence: 75,
    },
  },
});
