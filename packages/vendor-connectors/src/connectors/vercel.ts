import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Vercel connector.
 *
 * Vercel CLI / API / SDK breaking changes:
 * - CLI auth moved from `now` tokens to `vercel` login + `VERCEL_TOKEN`;
 *   legacy `now.json` config keys were renamed.
 * - The REST API token auth header changed (`Authorization: Bearer` with
 *   team scoping via `x-vercel-team`).
 * - `@vercel/node` builder API changed (now.json build config ->
 *   vercel.json functions).
 */
export const vercelConnector = defineConnector({
  slug: "vercel",
  identifiers: ["vercel", "@vercel/*", "now"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "now token",
      newValue: "VERCEL_TOKEN / vercel login",
      description:
        "Vercel deprecated the legacy now tokens; use VERCEL_TOKEN (or vercel login) and the team-scoped API.",
      affectedSymbols: ["vercel", "now"],
      breaking: true,
      evidence: { sdk: "vercel", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "PARAMETER_RENAMED",
      oldValue: "now.json",
      newValue: "vercel.json",
      description:
        "now.json was renamed to vercel.json and build config keys changed (builds -> functions, routes unchanged).",
      affectedSymbols: ["now.json", "vercel.json"],
      breaking: true,
      evidence: { sdk: "vercel" },
    },
  ],
  patchSuggestions: {
    now: {
      replacement: "vercel",
      description: "Replace deprecated `now` CLI/SDK usage with `vercel` (VERCEL_TOKEN auth).",
      confidence: 90,
    },
    "now.json": {
      replacement: "vercel.json",
      description: "Rename now.json to vercel.json and migrate build config keys.",
      confidence: 88,
    },
  },
});
