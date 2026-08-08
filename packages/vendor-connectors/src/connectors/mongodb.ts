import { defineConnector } from "../sdk";

/**
 * MongoDB Node driver connector.
 *
 * MongoDB driver v6 -> v7 breaking changes:
 * - `MongoClient` connection handling changed (no more
 *   `client.connect()` returning a promise — it's now required).
 * - `Collection.find()` cursor API changed; `toArray`, `forEach` behavior
 *   and the `maxTimeMS` / options moved.
 * - `ObjectId` and `UUID` imports changed (mongodb vs bson).
 */
export const mongodbConnector = defineConnector({
  slug: "mongodb",
  identifiers: ["mongodb", "mongoose"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "client.connect()",
      description:
        "MongoDB driver v6+ requires connect() before use; v7 removed the auto-connect behavior.",
      affectedSymbols: ["MongoClient", "client.connect", "db.collection"],
      breaking: true,
      evidence: { sdk: "mongodb" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "cursor API",
      description: "Cursor methods changed across versions (toArray, forEach, maxTimeMS options).",
      affectedSymbols: ["find", "aggregate", "cursor"],
      breaking: true,
      evidence: { sdk: "mongodb" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "UUID / ObjectId imports",
      description: "UUID and ObjectId import paths changed between mongodb and bson packages.",
      affectedSymbols: ["ObjectId", "UUID", "BSON"],
      breaking: false,
      evidence: { sdk: "mongodb" },
    },
  ],
  patchSuggestions: {
    MongoClient: {
      replacement: "MongoClient",
      description:
        "Ensure client.connect() is awaited before use; update cursor/option usage to the current driver API.",
      confidence: 82,
    },
  },
});
