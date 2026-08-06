import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";
import { RiskTag } from "@patchbay/domain";

export const auth0Connector: VendorConnector = {
  slug: "auth0",

  supports(rawPayload: unknown): boolean {
    if (typeof rawPayload !== "object" || rawPayload === null) return false;
    const payload = rawPayload as Record<string, unknown>;
    return payload.sdk === "auth0" || payload.vendor === "auth0";
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload as Record<string, unknown>;
    if (!this.supports(payload)) return [];

    return [
      {
        changeType: "AUTH_CHANGE",
        oldValue: "jwtCheck",
        newValue: "auth0JwtBearer",
        description: "Auth0 SDK update: authentication middleware signature changed.",
        breaking: true,
        affectedSymbols: ["jwtCheck", "auth0JwtBearer"],
        evidence: { sdk: "auth0", riskTag: RiskTag.AUTH },
      },
    ];
  },

  buildPatchSuggestions(): PatchSuggestion[] {
    // Auth changes require mandatory human review; no automatic patch suggestion
    return [];
  },
};
