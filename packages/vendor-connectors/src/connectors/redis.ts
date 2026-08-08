import { defineConnector } from "../sdk";

/**
 * Redis client connector (ioredis / node-redis).
 *
 * Redis client breaking changes:
 * - node-redis v4 reworked the entire API (createClient options, no
 *   automatic connect).
 * - ioredis `redis.get`/`set` return types changed (null vs undefined)
 *   and the `duplicate()` / cluster API changed.
 * - Connection option renames (url, socket, password).
 */
export const redisConnector = defineConnector({
  slug: "redis",
  identifiers: ["ioredis", "redis", "node-redis", "@redis/*"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "redis.createClient",
      description:
        "node-redis v4 reworked createClient (connect must be awaited; options moved under socket).",
      affectedSymbols: ["createClient", "redis.get", "redis.set", "client.connect"],
      breaking: true,
      evidence: { sdk: "redis" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "connection options",
      description:
        "Connection options renamed (url, socket, password, username) across client majors.",
      affectedSymbols: ["ioredis", "createClient"],
      breaking: true,
      evidence: { sdk: "redis" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "get return type",
      description:
        "GET returns null (not undefined) on miss in node-redis v4; type-checks changed.",
      affectedSymbols: ["redis.get", "client.get"],
      breaking: false,
      evidence: { sdk: "redis" },
    },
  ],
  patchSuggestions: {
    createClient: {
      replacement: "createClient (v4)",
      description:
        "Update createClient to the v4 API: await client.connect(), socket options, url handling.",
      confidence: 85,
    },
  },
});
