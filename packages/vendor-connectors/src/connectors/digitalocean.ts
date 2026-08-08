import { defineConnector } from "../sdk";

/**
 * DigitalOcean connector.
 *
 * DigitalOcean API v2 changes:
 * - Pagination: `links.pages` renamed to `links.pages` (kept) but the
 *   `meta.total` -> `meta.total` count moved to `meta` object consistently.
 * - Rate limiting: the `x-ratelimit-*` headers changed; clients must
 *   handle 429 with Retry-After.
 * - `droplets.create` etc. changed response shapes (actions vs resources).
 */
export const digitaloceanConnector = defineConnector({
  slug: "digitalocean",
  identifiers: ["digitalocean", "do-wrapper", "@digitalocean/*"],
  rules: [
    {
      changeType: "RESPONSE_FIELD_REMOVED",
      oldValue: "links.pages / meta.total",
      description:
        "Pagination metadata moved to a consistent `meta` object; links.pages shape changed across API revisions.",
      affectedSymbols: ["digitalocean.droplets", "digitalocean.domains"],
      breaking: true,
      evidence: { sdk: "digitalocean" },
    },
    {
      changeType: "OTHER",
      oldValue: "rate limit headers",
      description:
        "Rate-limit headers changed; handle 429 with Retry-After instead of parsing legacy headers.",
      affectedSymbols: ["digitalocean"],
      breaking: false,
      evidence: { sdk: "digitalocean" },
    },
  ],
  patchSuggestions: {
    "digitalocean.droplets": {
      replacement: "digitalocean.droplets",
      description:
        "Update pagination handling to the current meta/links shape and handle 429 with Retry-After.",
      confidence: 75,
    },
  },
});
