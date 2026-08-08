import { defineConnector } from "../sdk";

/**
 * Elasticsearch connector.
 *
 * Elasticsearch JS client major version breaks:
 * - `client.search` body shape changed (ES 7 -> 8: `body` removed, params
 *   at top level).
 * - Typed client / generated clients changed constructor options.
 * - Response shape changed: `hits.hits` structure with `_source` etc.
 */
export const elasticsearchConnector = defineConnector({
  slug: "elasticsearch",
  identifiers: ["elasticsearch", "@elastic/elasticsearch"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "body in search",
      newValue: "top-level params",
      description:
        "ES 8 removed the body option; pass query/index params at the top level of search() calls.",
      affectedSymbols: ["client.search", "client.index", "client.bulk"],
      breaking: true,
      evidence: { sdk: "elasticsearch" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "hits.hits",
      description: "Search response structure changed across ES majors (_source, fields, sort).",
      affectedSymbols: ["client.search", "hits"],
      breaking: true,
      evidence: { sdk: "elasticsearch" },
    },
  ],
  patchSuggestions: {
    "client.search": {
      replacement: "client.search (top-level params)",
      description: "Move search body into top-level params (index, query) for the ES 8 client API.",
      confidence: 85,
    },
  },
});
