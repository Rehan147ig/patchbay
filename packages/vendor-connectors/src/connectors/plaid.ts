import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Plaid connector.
 *
 * Plaid product sunsetting and API changes:
 * - Products are sunset with long deprecation windows
 *   (e.g. transactions -> transactions/enrich, income removed).
 * - Transaction fields changed across versions (authorized_date,
 *   merchant_name, personal_finance_category).
 * - The client constructor changed (client_id + secret to PlaidClient).
 */
export const plaidConnector = defineConnector({
  slug: "plaid",
  identifiers: ["plaid", "plaid-node"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "transaction fields",
      description:
        "Plaid changed transaction response fields across versions (authorized_date, merchant_name, personal_finance_category).",
      affectedSymbols: ["transactions.get", "transactions.sync"],
      breaking: true,
      evidence: { sdk: "plaid", riskTag: RiskTag.PAYMENT },
    },
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "deprecated products",
      description:
        "Plaid sunsets products with long windows; deprecated products return errors when called.",
      affectedSymbols: ["income", "assets", "liabilities"],
      breaking: true,
      evidence: { sdk: "plaid", riskTag: RiskTag.PAYMENT },
    },
  ],
  patchSuggestions: {
    "transactions.get": {
      replacement: "transactions.get (current fields)",
      description:
        "Update transaction field reads to the current response shape (authorized_date, merchant_name).",
      confidence: 80,
    },
  },
});
