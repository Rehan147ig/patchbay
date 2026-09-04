import type { ConnectorRule } from "./sdk";

/**
 * Connector archetype helpers: reusable rule fragments for the most common
 * vendor migration shapes, so promoting a catalog connector to a certified
 * patch kit is data (a renames table) instead of a hand-written compiler.
 *
 * Archetype A (method renames): `client.oldMethod(...)` -> `client.newMethod(...)`
 * on the same call shape. Emitted as METHOD_RENAMED rules plus exact-symbol
 * patch suggestions; the remediation engine applies them line-locally and the
 * semantic gate rejects anything that stops parsing. Deterministic and pure.
 */

export interface MethodRenameEntry {
  /** Usage symbol the rule fixes (exact match, e.g. "cohere.generate"). */
  symbol: string;
  replacement: string;
  description: string;
  /** 0-100; defaults to 90 (mechanical rename on the same call shape). */
  confidence?: number;
  breaking?: boolean;
}

export interface MethodRenameKit {
  rules: ConnectorRule[];
  patchSuggestions: Record<
    string,
    { replacement: string; description: string; confidence: number }
  >;
}

/**
 * Builds the rules + patch-suggestion map for a method-rename migration kit
 * from a plain table. Additional affected symbols (aliases that resolve to
 * the same call, e.g. "mistral.chat.completions" alongside
 * "client.chat.completions.create") ride on the primary entry.
 */
export function methodRenameKit(
  entries: Array<
    MethodRenameEntry & {
      /** Extra usage symbols fixed by the same replacement. */
      aliases?: string[];
      evidence?: Record<string, unknown>;
    }
  >,
): MethodRenameKit {
  const rules: ConnectorRule[] = [];
  const patchSuggestions: MethodRenameKit["patchSuggestions"] = {};
  for (const entry of entries) {
    const confidence = entry.confidence ?? 90;
    rules.push({
      changeType: "METHOD_RENAMED",
      oldValue: entry.symbol,
      newValue: entry.replacement,
      description: entry.description,
      affectedSymbols: [entry.symbol, ...(entry.aliases ?? [])],
      breaking: entry.breaking ?? true,
      evidence: entry.evidence,
    });
    patchSuggestions[entry.symbol] = {
      replacement: entry.replacement,
      description: entry.description,
      confidence,
    };
    for (const alias of entry.aliases ?? []) {
      patchSuggestions[alias] = {
        replacement: entry.replacement,
        description: entry.description,
        confidence,
      };
    }
  }
  return { rules, patchSuggestions };
}
