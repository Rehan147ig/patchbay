import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Adyen connector.
 *
 * Adyen Checkout API versioning (v71+ breaking changes):
 * - `paymentMethods` response shape changed (storedPaymentMethods,
 *   brands arrays).
 * - Recurring/contract fields moved; `recurringProcessingModel` required
 *   for some merchants.
 * - Webhook (notification) payload schema versioning is strict — a
 *   mismatched version silently drops notifications.
 */
export const adyenConnector = defineConnector({
  slug: "adyen",
  identifiers: ["adyen", "@adyen/api-library"],
  rules: [
    {
      changeType: "PARAMETER_REQUIRED",
      oldValue: "recurringProcessingModel",
      description:
        "Adyen Checkout v71+ requires recurringProcessingModel for recurring payments; omitting it fails.",
      affectedSymbols: ["payments", "payments.submit"],
      breaking: true,
      evidence: { sdk: "adyen", riskTag: RiskTag.PAYMENT },
    },
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "notification payload",
      description:
        "Adyen notification schema is versioned; a mismatched version drops or reorders events.",
      affectedSymbols: ["adyen.notifications", "webhooks"],
      breaking: true,
      evidence: { sdk: "adyen", riskTag: RiskTag.WEBHOOK },
    },
  ],
  patchSuggestions: {
    payments: {
      replacement: "payments (v71+)",
      description:
        "Add recurringProcessingModel and update paymentMethods destructuring for the v71+ shape.",
      confidence: 78,
    },
  },
});
