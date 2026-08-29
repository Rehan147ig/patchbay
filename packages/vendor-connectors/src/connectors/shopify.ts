import { defineConnector } from "../sdk";

/**
 * Shopify connector.
 *
 * Shopify Admin API breaking changes:
 * - REST Admin API versioned (2024-01, 2024-04) - fields deprecated/removed
 * - GraphQL Admin API `products` -> `productsV2` in some versions
 */
export const shopifyConnector = defineConnector({
  slug: "shopify",
  identifiers: ["@shopify/shopify-api", "shopify-api-node", "@shopify/admin-api-client"],
  rules: [
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "/admin/api/2023-01/products.json",
      description: "Shopify REST Admin API versioned endpoints deprecated.",
      affectedSymbols: ["shopify.api", "admin/products"],
      breaking: true,
      evidence: { sdk: "shopify" },
    },
  ],
  patchSuggestions: {
    shopify: {
      replacement: "shopify (2024-04)",
      description: "Update Shopify Admin API to 2024-04 versioned endpoint.",
      confidence: 70,
    },
  },
});
