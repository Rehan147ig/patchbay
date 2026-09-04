import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";

/**
 * Google Gemini connector (`@google/generative-ai`).
 *
 * Payload-driven like the OpenAI connector: a bare `{ sdk }` payload yields
 * only a non-breaking version-upgrade draft (no patch kit), so unmatched
 * releases stay silent. Concrete renames arrive via
 * `migration.methodRenames` and normalize to exact-symbol METHOD_RENAMED
 * drafts with quote-safe line-local suggestions.
 *
 * Certified example: the constructor migration
 * `GoogleGenerativeAI` -> `getGenerativeModel`, proven by the
 * google-gemini-node-legacy fixture in the eval corpus.
 */

const IDENTIFIERS = ["gemini", "@google/generative-ai", "google-gemini"];

interface MethodRename {
  from: string;
  to: string;
}

interface GeminiMigrationPayload {
  sdk?: string;
  vendor?: string;
  fromVersion?: string;
  toVersion?: string;
  migration?: {
    methodRenames?: MethodRename[];
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGeminiPayload(payload: unknown): payload is GeminiMigrationPayload {
  if (!isObject(payload)) return false;
  const candidates = [payload.sdk, payload.vendor].filter(
    (value): value is string => typeof value === "string",
  );
  return candidates.some((candidate) => IDENTIFIERS.includes(candidate));
}

export const geminiConnector: VendorConnector = {
  slug: "google-gemini",

  supports(rawPayload: unknown): boolean {
    return isGeminiPayload(rawPayload);
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload;
    if (!isGeminiPayload(payload)) return [];

    const drafts: NormalizedChangeDraft[] = [];
    const fromVersion = payload.fromVersion;
    const toVersion = payload.toVersion;

    if (fromVersion !== undefined && toVersion !== undefined) {
      drafts.push({
        changeType: "SDK_VERSION_UPGRADE",
        oldValue: fromVersion,
        newValue: toVersion,
        description: `Upgrade the @google/generative-ai package from ${fromVersion} to ${toVersion}.`,
        breaking: false,
        affectedSymbols: [],
        evidence: { sdk: "google-gemini" },
      });
    }

    for (const rename of payload.migration?.methodRenames ?? []) {
      if (!rename.from || !rename.to) continue;
      drafts.push({
        changeType: "METHOD_RENAMED",
        oldValue: rename.from,
        newValue: rename.to,
        description: `Method ${rename.from} was renamed to ${rename.to} (@google/generative-ai).`,
        breaking: true,
        affectedSymbols: [rename.from],
        evidence: { sdk: "google-gemini", rule: "method-rename" },
      });
    }

    return drafts;
  },

  buildPatchSuggestions(normalizations): PatchSuggestion[] {
    const suggestions: PatchSuggestion[] = [];
    for (const normalization of normalizations) {
      if (normalization.changeType !== "METHOD_RENAMED") continue;
      const evidence = normalization.evidence as { rule?: string } | undefined;
      if (evidence?.rule !== "method-rename") continue;
      if (!normalization.oldValue || !normalization.newValue) continue;
      if (!normalization.affectedSymbols.includes(normalization.oldValue)) continue;
      suggestions.push({
        symbol: normalization.oldValue,
        replacement: normalization.newValue,
        description: `Rename ${normalization.oldValue} to ${normalization.newValue} (@google/generative-ai).`,
        confidence: 90,
      });
    }
    return suggestions;
  },
};
