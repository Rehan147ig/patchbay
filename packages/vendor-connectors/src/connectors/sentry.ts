import { defineConnector } from "../sdk";

/**
 * Sentry connector.
 *
 * Sentry SDK breaking changes:
 * - `Sentry.init` config changes across majors (tracesSampleRate vs
 *   tracesSampler, integrations array).
 * - The tracing API moved to `@sentry/node`/`@sentry/browser` with
 *   `@sentry/tracing` merged in.
 * - `captureException` / scope APIs changed (`withScope` -> `withScope`
 *   stayed but `Sentry.configureScope` removed in v8).
 */
export const sentryConnector = defineConnector({
  slug: "sentry",
  identifiers: ["sentry", "@sentry/node", "@sentry/browser", "@sentry/nextjs"],
  rules: [
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "tracesSampleRate",
      description:
        "Sentry v8 changed tracing config (tracesSampleRate/tracesSampler) and the integrations array shape.",
      affectedSymbols: ["Sentry.init"],
      breaking: true,
      evidence: { sdk: "sentry" },
    },
    {
      changeType: "METHOD_REMOVED",
      oldValue: "Sentry.configureScope",
      newValue: "withScope / getCurrentScope",
      description: "Sentry v8 removed configureScope; use getCurrentScope().setTag or withScope.",
      affectedSymbols: ["configureScope", "withScope", "getCurrentScope"],
      breaking: true,
      evidence: { sdk: "sentry" },
    },
    {
      changeType: "SDK_VERSION_UPGRADE",
      oldValue: "@sentry/tracing",
      description: "@sentry/tracing merged into the main SDKs; standalone tracing imports broke.",
      affectedSymbols: ["@sentry/tracing", "Sentry.Integrations"],
      breaking: true,
      evidence: { sdk: "sentry" },
    },
  ],
  patchSuggestions: {
    "Sentry.init": {
      replacement: "Sentry.init (v8)",
      description:
        "Update Sentry.init to the v8 config (tracing + integrations shape); drop @sentry/tracing imports.",
      confidence: 82,
    },
    configureScope: {
      replacement: "getCurrentScope()",
      description: "Replace Sentry.configureScope(fn) with getCurrentScope().setTag/setExtra (v8).",
      confidence: 85,
    },
  },
});
