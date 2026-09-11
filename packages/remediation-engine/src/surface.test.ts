import { describe, expect, it } from "vitest";
import type { ChangeType } from "@patchbay/domain";
import type { NormalizedChangeDraft, PatchSuggestion } from "@patchbay/vendor-connectors";
import type { PlanUsage } from "./types";
import { attributeSurfaces, surfaceOfChangeType, surfaceOfUsageType } from "./surface";

function norm(changeType: ChangeType, affectedSymbols: string[] = []): NormalizedChangeDraft {
  return { changeType, affectedSymbols, breaking: true };
}

function usage(symbol: string, filePath = "src/a.ts", usageType?: string): PlanUsage {
  return { filePath, line: 1, symbol, excerpt: "x", ...(usageType ? { usageType } : {}) };
}

describe("surfaceOfChangeType", () => {
  it("routes symbol changes to the sdk lane", () => {
    expect(surfaceOfChangeType("SDK_VERSION_UPGRADE")).toBe("sdk");
    expect(surfaceOfChangeType("METHOD_RENAMED")).toBe("sdk");
    expect(surfaceOfChangeType("METHOD_REMOVED")).toBe("sdk");
  });

  it("routes contract-behavior changes to the api lane", () => {
    const api: ChangeType[] = [
      "PARAMETER_RENAMED",
      "PARAMETER_REMOVED",
      "PARAMETER_REQUIRED",
      "RESPONSE_FIELD_REMOVED",
      "RESPONSE_FIELD_TYPE_CHANGED",
      "ENDPOINT_REMOVED",
      "AUTH_CHANGE",
      "NEW_CAPABILITY",
    ];
    for (const changeType of api) expect(surfaceOfChangeType(changeType)).toBe("api");
  });

  it("routes webhook changes to the webhook lane and OTHER to unclassified", () => {
    expect(surfaceOfChangeType("WEBHOOK_CHANGE")).toBe("webhook");
    expect(surfaceOfChangeType("OTHER")).toBe("unclassified");
  });
});

describe("surfaceOfUsageType", () => {
  it("decides only the unambiguous constructs", () => {
    expect(surfaceOfUsageType("WEBHOOK")).toBe("webhook");
    expect(surfaceOfUsageType("ENDPOINT_CALL")).toBe("api");
    expect(surfaceOfUsageType("METHOD_CALL")).toBeNull();
    expect(surfaceOfUsageType("IMPORT")).toBeNull();
    expect(surfaceOfUsageType(undefined)).toBeNull();
  });
});

describe("attributeSurfaces", () => {
  it("attributes usages and suggestions through normalization symbols", () => {
    const attribution = attributeSurfaces({
      usages: [usage("openai.createChatCompletion"), usage("completion.data")],
      patchSuggestions: [
        { symbol: "openai.createChatCompletion", replacement: "x", description: "", confidence: 1 },
      ] as PatchSuggestion[],
      normalizations: [
        norm("METHOD_RENAMED", ["openai.createChatCompletion"]),
        norm("RESPONSE_FIELD_REMOVED", ["completion.data"]),
      ],
    });
    expect(attribution.activeSurfaces).toEqual(["sdk", "api"]);
    expect(attribution.usageLanes.get(0)).toEqual(new Set(["sdk"]));
    expect(attribution.usageLanes.get(1)).toEqual(new Set(["api"]));
    expect(attribution.suggestionLanes.get("openai.createChatCompletion")).toEqual(
      new Set(["sdk"]),
    );
    expect(attribution.filesByLane.get("sdk")).toEqual(new Set(["src/a.ts"]));
  });

  it("unions lanes when several surfaces name the same symbol", () => {
    const attribution = attributeSurfaces({
      usages: [usage("shared.symbol")],
      patchSuggestions: [],
      normalizations: [
        norm("METHOD_RENAMED", ["shared.symbol"]),
        norm("WEBHOOK_CHANGE", ["shared.symbol"]),
      ],
    });
    expect(attribution.usageLanes.get(0)).toEqual(new Set(["sdk", "webhook"]));
  });

  it("falls back to unclassified when nothing references the usage", () => {
    const attribution = attributeSurfaces({
      usages: [usage("unknown.symbol")],
      patchSuggestions: [],
      normalizations: [norm("METHOD_RENAMED", ["other.symbol"])],
    });
    expect(attribution.usageLanes.get(0)).toEqual(new Set(["unclassified"]));
  });

  it("lanes an explicit webhook usageType as webhook without legacy fallback", () => {
    const attribution = attributeSurfaces({
      usages: [usage("some.handler", "src/webhooks/stripe.ts", "WEBHOOK")],
      patchSuggestions: [],
      normalizations: [norm("METHOD_RENAMED", ["other.symbol"])],
    });
    // An explicit construct signal needs no unclassified fallback: the usage
    // is known to be a handler, so the legacy path must not claim it too.
    expect(attribution.usageLanes.get(0)).toEqual(new Set(["webhook"]));
  });

  it("lanes files by API symbol text even without a pointing usage", () => {
    const attribution = attributeSurfaces({
      usages: [usage("openai.createChatCompletion", "src/chat.ts")],
      patchSuggestions: [],
      normalizations: [
        norm("METHOD_RENAMED", ["openai.createChatCompletion"]),
        norm("RESPONSE_FIELD_REMOVED", ["completion.data"]),
      ],
      readFile: (filePath) => (filePath === "src/chat.ts" ? "const x = completion.data;\n" : null),
    });
    expect(attribution.filesByLane.get("api")).toEqual(new Set(["src/chat.ts"]));
    expect(attribution.apiTextFiles).toEqual(new Set(["src/chat.ts"]));
    expect(attribution.involvedCountByLane.get("api")).toBe(1);
  });

  it("does not lane files whose text lacks every API symbol", () => {
    const attribution = attributeSurfaces({
      usages: [usage("openai.createChatCompletion", "src/chat.ts")],
      patchSuggestions: [],
      normalizations: [
        norm("METHOD_RENAMED", ["openai.createChatCompletion"]),
        norm("RESPONSE_FIELD_REMOVED", ["completion.data"]),
      ],
      readFile: () => "const y = 1;\n",
    });
    expect(attribution.filesByLane.get("api")).toBeUndefined();
    expect(attribution.apiTextFiles).toEqual(new Set());
  });
});
