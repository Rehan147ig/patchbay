import { defineConnector } from "../sdk";

/**
 * Cloudflare connector.
 *
 * Cloudflare Workers / Pages API changes:
 * - Workers `wrangler` config keys moved around (env/durable objects,
 *   `kv_namespaces` -> `kv_namespaces` still but bindings renamed).
 * - Pages Functions / `_worker.js` deprecation; `wrangler pages` merged
 *   into `wrangler deploy`.
 * - The Workers runtime removed some legacy bindings (e.g. `Sentry` ->
 *   `SentryClient`, `KVNamespace.get` behavior changes).
 */
export const cloudflareConnector = defineConnector({
  slug: "cloudflare",
  identifiers: ["cloudflare", "wrangler", "@cloudflare/*"],
  rules: [
    {
      changeType: "PARAMETER_RENAMED",
      oldValue: "wrangler.toml bindings",
      description:
        "wrangler config bindings were renamed across versions (kv_namespaces, durable_objects, env shapes).",
      affectedSymbols: ["wrangler.toml", "wrangler.jsonc", "env"],
      breaking: true,
      evidence: { sdk: "cloudflare" },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "wrangler pages publish",
      newValue: "wrangler deploy",
      description:
        "wrangler pages subcommands were merged into wrangler deploy; legacy publish is gone.",
      affectedSymbols: ["wrangler"],
      breaking: true,
      evidence: { sdk: "cloudflare" },
    },
    {
      changeType: "OTHER",
      oldValue: "KVNamespace / D1 bindings",
      description:
        "Runtime binding types changed (D1, R2, KV); some legacy helpers were removed in favor of the new runtime APIs.",
      affectedSymbols: ["env.KV", "env.DB", "env.R2", "KVNamespace"],
      breaking: false,
      evidence: { sdk: "cloudflare" },
    },
  ],
  patchSuggestions: {
    wrangler: {
      replacement: "wrangler deploy",
      description:
        "Migrate wrangler pages/publish commands to wrangler deploy and update bindings in wrangler.toml.",
      confidence: 80,
    },
  },
});
