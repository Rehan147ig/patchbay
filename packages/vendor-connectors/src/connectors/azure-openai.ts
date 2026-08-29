import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Azure OpenAI connector.
 *
 * Azure OpenAI SDK breaking changes:
 * - `AzureOpenAI` client constructor changed (apiVersion required)
 * - `chat.completions.create` moved under `azure` namespace
 */
export const azureOpenAiConnector = defineConnector({
  slug: "azure-openai",
  identifiers: ["@azure/openai", "openai", "azure-openai"],
  rules: [
    {
      changeType: "PARAMETER_REQUIRED",
      oldValue: "apiVersion",
      description: "Azure OpenAI requires apiVersion in client constructor (2024-02-15-preview+).",
      affectedSymbols: ["AzureOpenAI", "OpenAIClient"],
      breaking: true,
      evidence: { sdk: "azure-openai", riskTag: RiskTag.AUTH },
    },
  ],
  patchSuggestions: {
    AzureOpenAI: {
      replacement: "AzureOpenAI (apiVersion)",
      description: "Add apiVersion to AzureOpenAI constructor.",
      confidence: 72,
    },
  },
});
