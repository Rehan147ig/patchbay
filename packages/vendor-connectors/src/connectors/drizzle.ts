import { defineConnector } from "../sdk";

/**
 * Drizzle connector.
 *
 * Drizzle ORM 0.x churn:
 * - Query builder API renamed across 0.x (db.select().from() stayed but
 *   where/join/orderBy signatures changed).
 * - Schema definition moved to `drizzle-orm/pg-core` etc. with renamed
 *   helpers (pgTable, serial, text).
 * - `drizzle-kit` config (drizzle.config.ts) changed across versions.
 */
export const drizzleConnector = defineConnector({
  slug: "drizzle",
  identifiers: ["drizzle", "drizzle-orm", "drizzle-kit"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "query builder API",
      description:
        "Drizzle 0.x renames query builder methods and signatures (where, join, orderBy) across versions.",
      affectedSymbols: ["db.select", "db.insert", "db.update", "db.delete"],
      breaking: true,
      evidence: { sdk: "drizzle" },
    },
    {
      changeType: "PARAMETER_RENAMED",
      oldValue: "drizzle-kit config",
      description: "drizzle.config.ts schema changed across versions (out, schema, dialect keys).",
      affectedSymbols: ["drizzle.config.ts", "drizzle-kit"],
      breaking: true,
      evidence: { sdk: "drizzle" },
    },
  ],
  patchSuggestions: {
    "db.select": {
      replacement: "db.select",
      description:
        "Update db.select().from() chains to the current 0.x API (where/join/orderBy signatures).",
      confidence: 75,
    },
  },
});
