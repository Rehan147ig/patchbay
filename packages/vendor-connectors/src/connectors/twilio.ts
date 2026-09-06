import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";
import type { RulePack } from "@patchbay/domain";

export const twilioConnector: VendorConnector = {
  slug: "twilio",

  /** WP6 rule-pack declaration (see openai.ts for the contract semantics). */
  rulePack: {
    packVersion: "1.0.0",
    vendorSlug: "twilio",
    contractKind: "SDK",
    supportedChanges: ["METHOD_RENAMED"],
    editBudget: { maxFiles: 10, maxEditsPerFile: 10, maxTotalBytes: 50_000 },
    expectedEvidence: { requiresSourceHash: true, requiresLockfileVersion: true, minUsages: 1 },
    validationProfile: "node-ts-reparse + container-sandbox",
    riskTags: [],
    rollback: {
      strategy: "revert-commit",
      instructions: "Revert the Patchbay draft PR branch before merge.",
    },
  } satisfies RulePack,

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
