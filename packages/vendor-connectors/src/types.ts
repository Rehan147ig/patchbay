import type { ChangeType } from "@patchbay/domain";

/**
 * Contract for vendor connectors. Connectors encode vendor-specific, deterministic
 * knowledge: how a raw change event payload normalizes into `NormalizedChange` rows
 * and which patch rules apply. They are pure (no DB, no network) so they stay
 * unit-testable like every other engine package.
 */

export interface NormalizedChangeDraft {
  changeType: ChangeType;
  oldValue?: string;
  newValue?: string;
  description?: string;
  breaking: boolean;
  /**
   * Usage symbols (`IntegrationUsage.symbol`) this change makes obsolete or affected.
   * The scoring engine matches `usage.symbol` against these.
   */
  affectedSymbols: string[];
  evidence?: Record<string, unknown>;
}

export interface NormalizeChangeInput {
  rawPayload: unknown;
  sourceType: string;
}

/**
 * Rule-based, deterministic edit suggestion for a usage symbol. Advisory only:
 * the remediation engine (Phase 4) applies and validates these, never a connector.
 */
export interface PatchSuggestion {
  /** `usage.symbol` this suggestion applies to (exact match). */
  symbol: string;
  /** Replacement symbol (same call shape, new name). */
  replacement: string;
  description: string;
  /** 0-100; connectors only suggest when they are confident in the rule. */
  confidence: number;
  /**
   * Feature-adoption edit: when set, insert `insertText` right after `searchText`
   * on the usage's source line (e.g. adding a newly launched optional option).
   * Both strings must appear on the same line for the rule to apply; `insertText`
   * must carry its own leading separator (e.g. `, response_format: {...}`) so the
   * patched line stays syntactically valid.
   */
  insert?: {
    searchText: string;
    insertText: string;
  };
}

export interface VendorConnector {
  slug: string;
  /** True when the connector understands this raw payload shape. */
  supports(rawPayload: unknown): boolean;
  /** Deterministically turns an event's raw payload into NormalizedChange drafts. */
  normalizeChange(input: NormalizeChangeInput): NormalizedChangeDraft[];
  /** Patch rules for affected usage symbols derived from the normalized changes. */
  buildPatchSuggestions(normalizations: NormalizedChangeDraft[]): PatchSuggestion[];
}
