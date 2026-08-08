import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Square connector.
 *
 * Square API deprecations:
 * - `catalog` / `orders` API field moves (line item structure changed in
 *   newer API versions).
 * - `locations.list` / `transactions` API removed (use `payments`).
 * - The SDK client constructor changed (environment + access token).
 */
export const squareConnector = defineConnector({
  slug: "square",
  identifiers: ["square", "square-connect", "@square/squarejs-sdk"],
  rules: [
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "transactions API",
      newValue: "payments API",
      description:
        "Square removed the legacy transactions API; use the payments API (payments.list, payments.get).",
      affectedSymbols: ["square.transactions", "transactions.list"],
      breaking: true,
      evidence: { sdk: "square", riskTag: RiskTag.PAYMENT },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "catalog / orders fields",
      description:
        "Order line item and catalog object fields changed across API versions; deprecated fields were removed.",
      affectedSymbols: ["square.orders", "square.catalog"],
      breaking: true,
      evidence: { sdk: "square", riskTag: RiskTag.PAYMENT },
    },
  ],
  patchSuggestions: {
    "square.transactions": {
      replacement: "square.payments",
      description: "Migrate transactions API calls to the payments API.",
      confidence: 85,
    },
  },
});
