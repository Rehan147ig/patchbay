import { defineConnector } from "../sdk";

/**
 * Google Gemini connector.
 *
 * The `@google/generative-ai` SDK restructured across versions:
 * - `generateContent` -> `generateContent` (unchanged) but the constructor
 *   moved from `new GoogleGenerativeAI(apiKey)` to per-client factories
 *   (`getGenerativeModel`).
 * - `response.text()` still exists but `response.candidates[0].content`
 *   is the canonical shape; `parts` replaced `content` in some versions.
 * - Safety settings and `safetySettings` field naming changed.
 */
export const geminiConnector = defineConnector({
  slug: "google-gemini",
  identifiers: ["gemini", "@google/generative-ai", "google-gemini"],
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "new GoogleGenerativeAI(apiKey)",
      newValue: "getGenerativeModel()",
      description:
        "The SDK moved to factory functions: GoogleGenerativeAI still exists but getGenerativeModel() is the canonical entrypoint.",
      affectedSymbols: ["GoogleGenerativeAI", "getGenerativeModel"],
      breaking: true,
      evidence: { sdk: "gemini" },
    },
    {
      changeType: "RESPONSE_FIELD_REMOVED",
      oldValue: "response.candidates[].content.parts",
      newValue: "response.text()",
      description:
        "Response text extraction changed; parts arrays are nested under content and text() is the stable accessor.",
      affectedSymbols: ["generateContent"],
      breaking: true,
      evidence: { sdk: "gemini" },
    },
    {
      changeType: "PARAMETER_RENAMED",
      oldValue: "safetySettings",
      description: "Safety settings were reorganized; the field shape changed across majors.",
      affectedSymbols: ["generateContent", "getGenerativeModel"],
      breaking: false,
      evidence: { sdk: "gemini" },
    },
  ],
  patchSuggestions: {
    GoogleGenerativeAI: {
      replacement: "getGenerativeModel",
      description:
        "Use getGenerativeModel({ model }) from @google/generative-ai instead of constructing GoogleGenerativeAI directly.",
      confidence: 82,
    },
    generateContent: {
      replacement: "generateContent",
      description:
        "Extract response text via response.text(); do not reach into candidates[].content.parts directly.",
      confidence: 88,
    },
  },
});
