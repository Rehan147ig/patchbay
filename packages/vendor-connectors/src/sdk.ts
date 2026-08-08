import type { ChangeType } from "@patchbay/domain";
import type {
  NormalizedChangeDraft,
  NormalizeChangeInput,
  PatchSuggestion,
  VendorConnector,
} from "./types";

/**
 * Declarative connector SDK.
 *
 * Most connectors are a list of "rules": a payload shape check, a set of
 * normalized changes, and a set of patch suggestions. This helper turns a
 * declarative spec into a full `VendorConnector` so new connectors are a few
 * dozen lines of data instead of boilerplate, and it enforces the contract
 * (pure functions, no DB/network) by construction.
 */

export interface ConnectorRule {
  /**
   * A `ChangeType` and, when the payload is a migration rule, the from/to
   * values. Multiple rules with the same changeType are collapsed.
   */
  changeType: ChangeType;
  oldValue?: string;
  newValue?: string;
  description?: string;
  /** Usage symbols this change makes affected. */
  affectedSymbols: string[];
  breaking?: boolean;
  evidence?: Record<string, unknown>;
}

export interface ConnectorSpec {
  slug: string;
  /** Acceptable `sdk` / `vendor` values in the raw payload. */
  identifiers: string[];
  /**
   * Optional: a custom `supports` predicate. When omitted, the connector
   * matches when `payload.sdk` or `payload.vendor` is one of `identifiers`.
   */
  supports?: (rawPayload: unknown) => boolean;
  /**
   * Rules applied to every accepted payload. `changeType` may be a single
   * value or, when the payload carries a `migration` array, derived from it.
   */
  rules: ConnectorRule[];
  /**
   * Patch suggestions keyed by the usage symbol they fix. A rename rule
   * (`oldValue` -> `newValue`) yields a symbol replacement suggestion.
   */
  patchSuggestions?: Record<
    string,
    {
      replacement: string;
      description: string;
      confidence: number;
      insert?: { searchText: string; insertText: string };
    }
  >;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function defaultSupports(identifiers: string[], rawPayload: unknown): boolean {
  if (!isObject(rawPayload)) return false;
  const sdk = rawPayload.sdk;
  const vendor = rawPayload.vendor;
  const candidates: string[] = [];
  if (typeof sdk === "string") candidates.push(sdk);
  if (typeof vendor === "string") candidates.push(vendor);
  if (candidates.length === 0) return false;

  for (const identifier of identifiers) {
    if (!identifier) continue;
    // Exact match or glob-style match (e.g. "@google-cloud/*").
    if (identifier.includes("*")) {
      const re = new RegExp(
        `^${identifier
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*")}$`,
      );
      if (candidates.some((candidate) => re.test(candidate))) return true;
    } else if (candidates.includes(identifier)) {
      return true;
    }
  }
  return false;
}

/**
 * Build a connector from a declarative spec. All functions are pure and
 * deterministic; callers never touch the connector's internals.
 */
export function defineConnector(spec: ConnectorSpec): VendorConnector {
  const supports = spec.supports ?? ((raw) => defaultSupports(spec.identifiers, raw));

  function normalizeChange(input: NormalizeChangeInput): NormalizedChangeDraft[] {
    if (!supports(input.rawPayload)) return [];
    const payload = isObject(input.rawPayload) ? input.rawPayload : {};
    // Allow rules to be expressed against a `migration` array in the payload.
    const migrations = Array.isArray(payload.migration)
      ? (payload.migration as Array<Record<string, unknown>>)
      : [payload];

    const drafts: NormalizedChangeDraft[] = [];
    for (const migration of migrations) {
      for (const rule of spec.rules) {
        const oldValue =
          rule.oldValue ??
          (typeof migration.oldValue === "string" ? migration.oldValue : undefined);
        const newValue =
          rule.newValue ??
          (typeof migration.newValue === "string" ? migration.newValue : undefined);
        const changeType =
          typeof migration.changeType === "string"
            ? (migration.changeType as ChangeType)
            : rule.changeType;
        drafts.push({
          changeType,
          oldValue,
          newValue,
          description: rule.description,
          breaking: rule.breaking ?? true,
          affectedSymbols: rule.affectedSymbols,
          evidence: rule.evidence,
        });
      }
    }
    return drafts;
  }

  function buildPatchSuggestions(normalizations: NormalizedChangeDraft[]): PatchSuggestion[] {
    const suggestions: PatchSuggestion[] = [];
    for (const normalization of normalizations) {
      for (const symbol of normalization.affectedSymbols) {
        const patch = spec.patchSuggestions?.[symbol];
        if (!patch) continue;
        suggestions.push({
          symbol,
          replacement: patch.replacement,
          description: patch.description,
          confidence: patch.confidence,
          ...(patch.insert ? { insert: patch.insert } : {}),
        });
      }
    }
    return suggestions;
  }

  return { slug: spec.slug, supports, normalizeChange, buildPatchSuggestions };
}
