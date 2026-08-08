import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * PayPal connector.
 *
 * PayPal v2 Orders API breaking changes:
 * - `intent` field on order creation removed/optional; use
 *   `purchase_units` + `intent` combos carefully.
 * - `payment_method` / `payer` structure changed between v1 and v2.
 * - Webhook events payload changed (v1 event types -> v2).
 */
export const paypalConnector = defineConnector({
  slug: "paypal",
  identifiers: ["paypal", "@paypal/checkout-server-sdk", "paypal-rest-sdk"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "orders.create intent",
      description:
        "PayPal v2 orders: the intent field moved/relaxed; purchase_units and payment_source structure changed.",
      affectedSymbols: ["orders.create", "orders.capture"],
      breaking: true,
      evidence: { sdk: "paypal", riskTag: RiskTag.PAYMENT },
    },
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "webhook event payload",
      description:
        "Webhook event names and payloads changed between API versions; verify event version handling.",
      affectedSymbols: ["paypal.webhooks", "webhooks"],
      breaking: true,
      evidence: { sdk: "paypal", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "paypal-rest-sdk",
      description:
        "The legacy paypal-rest-sdk is deprecated; migrate to @paypal/checkout-server-sdk.",
      affectedSymbols: ["paypal.payment.create", "paypal.payment.execute"],
      breaking: true,
      evidence: { sdk: "paypal", riskTag: RiskTag.PAYMENT },
    },
  ],
  patchSuggestions: {
    "orders.create": {
      replacement: "orders.create (v2)",
      description:
        "Update orders.create to the v2 shape (intent + purchase_units + payment_source).",
      confidence: 80,
    },
    "paypal.payment.create": {
      replacement: "@paypal/checkout-server-sdk orders",
      description: "Migrate paypal-rest-sdk payments to the checkout-server-sdk orders API.",
      confidence: 85,
    },
  },
});
