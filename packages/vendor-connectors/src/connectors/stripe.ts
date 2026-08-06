import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";
import { RiskTag } from "@patchbay/domain";

export const stripeConnector: VendorConnector = {
  slug: "stripe",

  supports(rawPayload: unknown): boolean {
    if (typeof rawPayload !== "object" || rawPayload === null) return false;
    const payload = rawPayload as Record<string, unknown>;
    return payload.sdk === "stripe" || payload.vendor === "stripe";
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload as Record<string, unknown>;
    if (!this.supports(payload)) return [];

    return [
      {
        changeType: "PARAMETER_REQUIRED",
        oldValue: "stripe.customers.create()",
        newValue: "stripe.customers.create({ metadata: ... })",
        description: "Stripe API update: customer creation requires metadata tracking.",
        breaking: true,
        affectedSymbols: ["stripe.customers.create"],
        evidence: { sdk: "stripe", riskTag: RiskTag.PAYMENT },
      },
    ];
  },

  buildPatchSuggestions(normalizations): PatchSuggestion[] {
    const suggestions: PatchSuggestion[] = [];
    for (const norm of normalizations) {
      if (norm.affectedSymbols.includes("stripe.customers.create")) {
        suggestions.push({
          symbol: "stripe.customers.create",
          replacement: "stripe.customers.create",
          description: "Ensure customer creation passes metadata payload.",
          confidence: 85,
        });
      }
    }
    return suggestions;
  },
};
