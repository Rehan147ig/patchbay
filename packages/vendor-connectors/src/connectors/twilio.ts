import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";

export const twilioConnector: VendorConnector = {
  slug: "twilio",

  supports(rawPayload: unknown): boolean {
    if (typeof rawPayload !== "object" || rawPayload === null) return false;
    const payload = rawPayload as Record<string, unknown>;
    return payload.sdk === "twilio" || payload.vendor === "twilio";
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload as Record<string, unknown>;
    if (!this.supports(payload)) return [];

    return [
      {
        changeType: "METHOD_RENAMED",
        oldValue: "client.messages.create",
        newValue: "client.messages.createV2",
        description: "Twilio SDK deprecation: legacy messaging API endpoint updated.",
        breaking: true,
        affectedSymbols: ["client.messages.create"],
        evidence: { sdk: "twilio" },
      },
    ];
  },

  buildPatchSuggestions(normalizations): PatchSuggestion[] {
    const suggestions: PatchSuggestion[] = [];
    for (const norm of normalizations) {
      if (norm.oldValue === "client.messages.create" && norm.newValue) {
        suggestions.push({
          symbol: norm.oldValue,
          replacement: norm.newValue,
          description: "Update legacy Twilio messaging call.",
          confidence: 80,
        });
      }
    }
    return suggestions;
  },
};
