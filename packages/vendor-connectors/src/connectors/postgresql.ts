import { defineConnector } from "../sdk";

/**
 * PostgreSQL (pg) connector.
 *
 * node-postgres breaking changes:
 * - `pg` Client `query` callback -> promise
 * - `pg` Pool `connect()` error handling changed
 */
export const postgresqlConnector = defineConnector({
  slug: "postgresql",
  identifiers: ["pg", "pg-promise", "postgres", "@prisma/client"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "pg callback",
      description: "pg Client query callback signature changed across majors.",
      affectedSymbols: ["pg.Client", "client.query"],
      breaking: true,
      evidence: { sdk: "postgresql" },
    },
  ],
  patchSuggestions: {
    "client.query": {
      replacement: "client.query (promise)",
      description: "Migrate pg query from callback to promise.",
      confidence: 70,
    },
  },
});
