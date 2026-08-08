import { defineConnector } from "../sdk";

/**
 * Algolia connector.
 *
 * Algolia JS client v4 -> v5 breaking changes:
 * - `algoliasearch` client init changed (searchClient vs adminClient).
 * - Index methods renamed: `index.addObject` -> `index.saveObjects`,
 *   `index.deleteByQuery` -> `deleteBy`.
 * - Response shape: `nbHits` -> `nbHits` kept, but `hits` per page
 *   structure changed.
 */
export const algoliaConnector = defineConnector({
  slug: "algolia",
  identifiers: ["algolia", "algoliasearch"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "index.addObject",
      newValue: "index.saveObjects",
      description:
        "Algolia v5 renamed addObject/deleteByQuery to saveObjects/deleteBy; the client split into search/admin.",
      affectedSymbols: [
        "index.addObject",
        "index.deleteByQuery",
        "index.saveObjects",
        "index.deleteBy",
      ],
      breaking: true,
      evidence: { sdk: "algolia" },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "algoliasearch client init",
      description:
        "The v5 client split: use algoliasearch(appId, key) then searchClient vs adminClient roles.",
      affectedSymbols: ["algoliasearch", "searchClient", "adminClient"],
      breaking: true,
      evidence: { sdk: "algolia" },
    },
  ],
  patchSuggestions: {
    "index.addObject": {
      replacement: "index.saveObjects",
      description: "Replace addObject with saveObjects (Algolia v5).",
      confidence: 88,
    },
    "index.deleteByQuery": {
      replacement: "index.deleteBy",
      description: "Replace deleteByQuery with deleteBy (Algolia v5).",
      confidence: 88,
    },
  },
});
