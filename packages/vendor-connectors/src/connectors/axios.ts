import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Axios connector.
 *
 * Covers the most commonly breaking changes across axios major versions:
 * - axios@1 dropped the `cancel` method in favor of AbortController
 *   (`CancelToken` still exists but is deprecated).
 * - Response interceptor chaining semantics changed; `validateStatus`
 *   still works but default behavior for HTTP 3xx was tightened.
 * - `adapter` config can now be an array (axios >= 1.5).
 */
export const axiosConnector = defineConnector({
  slug: "axios",
  identifiers: ["axios"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "axios.CancelToken.source",
      newValue: "AbortController",
      description:
        "axios@1 removed the `cancel` method; use AbortController with a signal instead of CancelToken.source().",
      affectedSymbols: ["axios.CancelToken.source", "axios.CancelToken"],
      breaking: true,
      evidence: { sdk: "axios", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "config.adapter",
      newValue: "config.adapter[]",
      description:
        "axios >= 1.5 accepts `adapter` as an array of adapters; a string still works but the array form is preferred.",
      affectedSymbols: ["axios.create", "axios.request", "axios.get", "axios.post"],
      breaking: false,
      evidence: { sdk: "axios" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "response.statusText",
      description:
        "In HTTP/2 the statusText is empty; code reading it must tolerate an empty string.",
      affectedSymbols: ["response.statusText"],
      breaking: false,
      evidence: { sdk: "axios" },
    },
  ],
  patchSuggestions: {
    "axios.CancelToken.source": {
      replacement: "AbortController",
      description:
        "Replace CancelToken.source() with `new AbortController()` and pass `signal` in the request config.",
      confidence: 90,
    },
    "axios.CancelToken": {
      replacement: "AbortSignal",
      description:
        "Replace CancelToken usage with AbortSignal from an AbortController; the `signal` config field is the axios@1 way to cancel.",
      confidence: 90,
    },
  },
});
