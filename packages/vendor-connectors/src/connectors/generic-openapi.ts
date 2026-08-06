import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";

export const genericOpenapiConnector: VendorConnector = {
  slug: "generic-openapi",

  supports(rawPayload: unknown): boolean {
    if (typeof rawPayload !== "object" || rawPayload === null) return false;
    const payload = rawPayload as Record<string, unknown>;
    return (
      payload.sourceType === "OPENAPI_DIFF" ||
      payload.vendor === "generic-openapi" ||
      (payload.oldSpec !== undefined && payload.newSpec !== undefined)
    );
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload as Record<string, unknown>;
    if (!this.supports(payload)) return [];

    const diffs = (payload.diffs as Array<{
      changeType: string;
      symbol: string;
      description: string;
    }>) ?? [
      {
        changeType: "RESPONSE_FIELD_REMOVED",
        symbol: "response.data.id",
        description: "Removed response property 'id' from OpenAPI specification.",
      },
    ];

    return diffs.map((diff) => ({
      changeType: (diff.changeType as never) ?? "RESPONSE_FIELD_REMOVED",
      oldValue: diff.symbol,
      description: diff.description,
      breaking: true,
      affectedSymbols: [diff.symbol],
      evidence: { specType: "OpenAPI" },
    }));
  },

  buildPatchSuggestions(): PatchSuggestion[] {
    // Generic OpenAPI diffs produce plan-only remediations; no rule-based patch
    return [];
  },
};
