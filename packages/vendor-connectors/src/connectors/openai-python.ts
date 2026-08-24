import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";

/**
 * OpenAI Python SDK connector.
 *
 * Knows the openai-python 0.x -> 1.x migration: module-level calls
 * (`openai.ChatCompletion.create(...)`) moved onto a client instance created
 * from `from openai import OpenAI` (`client.chat.completions.create(...)`).
 * Usage symbols come from the L1 tree-sitter extractor, which records the full
 * attribute chain rooted at the imported module alias — so the renames below
 * apply as line-level edits on those call sites. The remediation engine pairs
 * every applied rename whose replacement starts with the client variable with
 * a deterministic bootstrap (`from openai import OpenAI` + `client = OpenAI()`)
 * and re-parses the file with tree-sitter before emitting a diff.
 *
 * Expected raw payload (SDK release ingestion):
 * ```json
 * {
 *   "sdk": "openai-python",
 *   "fromVersion": "0.x",
 *   "toVersion": "1.x",
 *   "migration": {
 *     "methodRenames": [
 *       { "from": "openai.ChatCompletion.create", "to": "client.chat.completions.create" }
 *     ]
 *   }
 * }
 * ```
 */

interface MethodRename {
  from: string;
  to: string;
}

interface OpenAiPythonMigrationPayload {
  sdk?: string;
  vendor?: string;
  fromVersion?: string;
  toVersion?: string;
  migration?: {
    methodRenames?: MethodRename[];
  };
}

/** Client variable the deterministic rewrites bind; must stay in sync with the engine bootstrap rule. */
export const OPENAI_PYTHON_CLIENT_VARIABLE = "client";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOpenAiPythonPayload(payload: unknown): payload is OpenAiPythonMigrationPayload {
  if (!isObject(payload)) return false;
  if (payload.sdk !== "openai-python" && payload.vendor !== "openai-python") return false;
  return (
    (payload.fromVersion !== undefined && payload.toVersion !== undefined) ||
    isObject(payload.migration)
  );
}

export const openaiPythonConnector: VendorConnector = {
  slug: "openai-python",

  supports(rawPayload: unknown): boolean {
    return isOpenAiPythonPayload(rawPayload);
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload;
    if (!isOpenAiPythonPayload(payload)) return [];

    const drafts: NormalizedChangeDraft[] = [];
    const { fromVersion, toVersion } = payload;

    if (fromVersion !== undefined && toVersion !== undefined) {
      drafts.push({
        changeType: "SDK_VERSION_UPGRADE",
        oldValue: fromVersion,
        newValue: toVersion,
        description: `Upgrade the openai package (python) from ${fromVersion} to ${toVersion}.`,
        breaking: false,
        affectedSymbols: [],
        evidence: { sdk: "openai-python" },
      });
    }

    for (const rename of payload.migration?.methodRenames ?? []) {
      if (!rename.from || !rename.to) continue;
      drafts.push({
        changeType: "METHOD_RENAMED",
        oldValue: rename.from,
        newValue: rename.to,
        description: `Module-level call ${rename.from} moved onto the v1 client instance as ${rename.to}.`,
        breaking: true,
        affectedSymbols: [rename.from],
        evidence: { sdk: "openai-python", rule: "module-call-to-client" },
      });
    }

    return drafts;
  },

  buildPatchSuggestions(normalizations): PatchSuggestion[] {
    const suggestions: PatchSuggestion[] = [];
    for (const normalization of normalizations) {
      if (normalization.changeType !== "METHOD_RENAMED") continue;
      if (!normalization.oldValue || !normalization.newValue) continue;
      if (!normalization.affectedSymbols.includes(normalization.oldValue)) continue;
      suggestions.push({
        symbol: normalization.oldValue,
        replacement: normalization.newValue,
        description: `Rewrite ${normalization.oldValue} to ${normalization.newValue} (openai python v1 client) and ensure the client is constructed.`,
        confidence: 85,
      });
    }
    return suggestions;
  },
};
