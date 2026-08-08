import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Lemon Squeezy connector.
 *
 * Lemon Squeezy webhook/API changes:
 * - Webhook payloads are versioned; event names changed
 *   (order_created, subscription_updated).
 * - The API moved from v1 to the Lemon Squeezy API with
 *   `Accept: application/vnd.api+json` (JSON:API format).
 */
export const lemonSqueezyConnector = defineConnector({
  slug: "lemon-squeezy",
  identifiers: ["lemon-squeezy", "lemonsqueezy", "@lemonsqueezy/lemonsqueezy.js"],
  rules: [
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "webhook event names",
      description:
        "Lemon Squeezy webhook event names changed across versions (order_created, subscription_updated, etc.).",
      affectedSymbols: ["lemonsqueezy.webhooks", "webhooks"],
      breaking: true,
      evidence: { sdk: "lemon-squeezy", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "JSON:API envelope",
      description: "The API uses JSON:API format (data/relationships); direct field reads broke.",
      affectedSymbols: ["lemonsqueezy.orders", "lemonsqueezy.subscriptions"],
      breaking: true,
      evidence: { sdk: "lemon-squeezy", riskTag: RiskTag.PAYMENT },
    },
  ],
  patchSuggestions: {
    "lemonsqueezy.orders": {
      replacement: "lemonsqueezy.orders (JSON:API)",
      description:
        "Update order reads for the JSON:API envelope (data.attributes) and new event names.",
      confidence: 80,
    },
  },
});
