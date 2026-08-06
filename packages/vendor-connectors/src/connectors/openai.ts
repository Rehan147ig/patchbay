import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";

/**
 * OpenAI Node SDK connector.
 *
 * Knows the openai@3.x -> openai@4.x migration: the top-level `openai.createChatCompletion`
 * style methods moved onto the client instance (`client.chat.completions.create`), and v4
 * responses are returned directly instead of wrapped in `.data`.
 *
 * Also recognizes newly launched capabilities (feature adoption): a `capabilities` array
 * with deterministic adopt rules that the remediation engine can apply as line inserts.
 *
 * Expected raw payload (produced by the demo runner / SDK release ingestion):
 * ```json
 * {
 *   "sdk": "openai",
 *   "fromVersion": "3.x",
 *   "toVersion": "4.x",
 *   "migration": {
 *     "methodRenames": [{ "from": "openai.createChatCompletion", "to": "openai.chat.completions.create" }],
 *     "responseChanges": [{ "symbol": "completion.data", "description": "..." }]
 *   },
 *   "capabilities": [{
 *     "symbol": "openai.createChatCompletion",
 *     "feature": "Structured outputs (JSON mode)",
 *     "searchText": "model: \"gpt-4\"",
 *     "insertText": ", response_format: { type: \"json_object\" }"
 *   }]
 * }
 * ```
 */

interface MethodRename {
  from: string;
  to: string;
}

interface ResponseChange {
  symbol: string;
  description?: string;
}

interface Capability {
  symbol: string;
  feature: string;
  searchText: string;
  insertText: string;
}

interface OpenAiMigrationPayload {
  sdk: string;
  fromVersion?: string;
  toVersion?: string;
  migration?: {
    methodRenames?: MethodRename[];
    responseChanges?: ResponseChange[];
  };
  capabilities?: Capability[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpenAiPayload(payload: unknown): payload is OpenAiMigrationPayload {
  if (!isObject(payload) || payload.sdk !== "openai") return false;
  if (!isObject(payload.migration)) {
    return (
      payload.fromVersion !== undefined ||
      (Array.isArray(payload.capabilities) && payload.capabilities.length > 0)
    );
  }
  return true;
}

export const openaiConnector: VendorConnector = {
  slug: "openai",

  supports(rawPayload: unknown): boolean {
    return isOpenAiPayload(rawPayload);
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload;
    if (!isOpenAiPayload(payload)) return [];

    const drafts: NormalizedChangeDraft[] = [];
    const fromVersion = payload.fromVersion;
    const toVersion = payload.toVersion;

    if (fromVersion !== undefined && toVersion !== undefined) {
      drafts.push({
        changeType: "SDK_VERSION_UPGRADE",
        oldValue: fromVersion,
        newValue: toVersion,
        description: `Upgrade the openai package from ${fromVersion} to ${toVersion}.`,
        breaking: false,
        affectedSymbols: [],
        evidence: { sdk: "openai" },
      });
    }

    for (const rename of payload.migration?.methodRenames ?? []) {
      if (!rename.from || !rename.to) continue;
      drafts.push({
        changeType: "METHOD_RENAMED",
        oldValue: rename.from,
        newValue: rename.to,
        description: `Method ${rename.from} was renamed to ${rename.to} on the client instance.`,
        breaking: true,
        affectedSymbols: [rename.from],
        evidence: { sdk: "openai", rule: "method-rename" },
      });
    }

    for (const change of payload.migration?.responseChanges ?? []) {
      if (!change.symbol) continue;
      drafts.push({
        changeType: "RESPONSE_FIELD_REMOVED",
        oldValue: change.symbol,
        description:
          change.description ?? `Responses are no longer wrapped: ${change.symbol} is gone in v4.`,
        breaking: true,
        affectedSymbols: [change.symbol],
        evidence: { sdk: "openai", rule: "response-unwrap" },
      });
    }

    for (const capability of payload.capabilities ?? []) {
      if (!capability.symbol || !capability.feature) continue;
      drafts.push({
        changeType: "NEW_CAPABILITY",
        description: `OpenAI launched ${capability.feature}; adopting it is optional and non-breaking.`,
        breaking: false,
        affectedSymbols: [capability.symbol],
        evidence: {
          sdk: "openai",
          rule: "feature-adoption",
          feature: capability.feature,
          searchText: capability.searchText,
          insertText: capability.insertText,
        },
      });
    }

    return drafts;
  },

  buildPatchSuggestions(normalizations): PatchSuggestion[] {
    const suggestions: PatchSuggestion[] = [];
    for (const normalization of normalizations) {
      if (normalization.changeType === "METHOD_RENAMED") {
        if (!normalization.oldValue || !normalization.newValue) continue;
        if (!normalization.affectedSymbols.includes(normalization.oldValue)) continue;
        suggestions.push({
          symbol: normalization.oldValue,
          replacement: normalization.newValue,
          description: `Rename ${normalization.oldValue} to ${normalization.newValue} (openai v4).`,
          confidence: 95,
        });
      }
      if (normalization.changeType === "NEW_CAPABILITY") {
        const evidence = normalization.evidence as
          { rule?: string; feature?: string; searchText?: string; insertText?: string } | undefined;
        if (evidence?.rule !== "feature-adoption") continue;
        if (!evidence.searchText || !evidence.insertText) continue;
        for (const symbol of normalization.affectedSymbols) {
          suggestions.push({
            symbol,
            replacement: symbol,
            description: `Adopt ${evidence.feature}: insert '${evidence.insertText.trim()}' after '${evidence.searchText}'.`,
            confidence: 88,
            insert: { searchText: evidence.searchText, insertText: evidence.insertText },
          });
        }
      }
    }
    return suggestions;
  },
};
