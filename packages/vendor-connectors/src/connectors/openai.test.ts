import { describe, expect, it } from "vitest";
import { openaiConnector } from "../connectors/openai";

const SDK_MIGRATION_PAYLOAD = {
  sdk: "openai",
  fromVersion: "3.x",
  toVersion: "4.x",
  migration: {
    methodRenames: [
      { from: "openai.createChatCompletion", to: "openai.chat.completions.create" },
      { from: "openai.createCompletion", to: "openai.completions.create" },
    ],
    responseChanges: [{ symbol: "completion.data", description: "v4 returns the body directly." }],
  },
  breaking: true,
};

describe("openaiConnector.supports", () => {
  it("accepts an openai SDK release payload", () => {
    expect(openaiConnector.supports(SDK_MIGRATION_PAYLOAD)).toBe(true);
  });

  it("rejects payloads for other vendors and junk", () => {
    expect(openaiConnector.supports({ sdk: "stripe", fromVersion: "1", toVersion: "2" })).toBe(
      false,
    );
    expect(openaiConnector.supports(null)).toBe(false);
    expect(openaiConnector.supports("release notes")).toBe(false);
  });
});

describe("openaiConnector.normalizeChange", () => {
  it("produces version upgrade, method renames, and response changes", () => {
    const drafts = openaiConnector.normalizeChange({
      rawPayload: SDK_MIGRATION_PAYLOAD,
      sourceType: "SDK_RELEASE",
    });

    expect(drafts).toHaveLength(4);
    expect(drafts[0]).toMatchObject({
      changeType: "SDK_VERSION_UPGRADE",
      oldValue: "3.x",
      newValue: "4.x",
      breaking: false,
    });
    expect(drafts[1]).toMatchObject({
      changeType: "METHOD_RENAMED",
      oldValue: "openai.createChatCompletion",
      newValue: "openai.chat.completions.create",
      breaking: true,
      affectedSymbols: ["openai.createChatCompletion"],
    });
    expect(drafts[2]?.changeType).toBe("METHOD_RENAMED");
    expect(drafts[3]).toMatchObject({
      changeType: "RESPONSE_FIELD_REMOVED",
      oldValue: "completion.data",
      breaking: true,
      affectedSymbols: ["completion.data"],
    });
  });

  it("returns no drafts for unsupported payloads", () => {
    expect(
      openaiConnector.normalizeChange({ rawPayload: { sdk: "stripe" }, sourceType: "SDK_RELEASE" }),
    ).toEqual([]);
    expect(
      openaiConnector.normalizeChange({ rawPayload: null, sourceType: "SDK_RELEASE" }),
    ).toEqual([]);
  });

  it("skips malformed rename entries", () => {
    const drafts = openaiConnector.normalizeChange({
      rawPayload: {
        sdk: "openai",
        migration: {
          methodRenames: [{ from: "", to: "openai.chat.completions.create" }],
        },
      },
      sourceType: "SDK_RELEASE",
    });
    expect(drafts).toEqual([]);
  });
});

describe("openaiConnector.buildPatchSuggestions", () => {
  it("suggests direct renames only for METHOD_RENAMED changes", () => {
    const drafts = openaiConnector.normalizeChange({
      rawPayload: SDK_MIGRATION_PAYLOAD,
      sourceType: "SDK_RELEASE",
    });
    const suggestions = openaiConnector.buildPatchSuggestions(drafts);

    expect(suggestions).toEqual([
      {
        symbol: "openai.createChatCompletion",
        replacement: "openai.chat.completions.create",
        description:
          "Rename openai.createChatCompletion to openai.chat.completions.create (openai v4).",
        confidence: 95,
      },
      {
        symbol: "openai.createCompletion",
        replacement: "openai.completions.create",
        description: "Rename openai.createCompletion to openai.completions.create (openai v4).",
        confidence: 95,
      },
    ]);
  });
});

const MODEL_RETIREMENT_PAYLOAD = {
  sdk: "openai",
  modelRetirements: [
    { model: "gpt-4o", replacement: "gpt-4o-mini" },
    { model: "", replacement: "gpt-4o-mini" },
    { model: "gpt-3.5-turbo", replacement: "" },
  ],
};

describe("openaiConnector model retirements", () => {
  it("supports payloads carrying only model retirements", () => {
    expect(openaiConnector.supports(MODEL_RETIREMENT_PAYLOAD)).toBe(true);
    expect(openaiConnector.supports({ sdk: "openai", modelRetirements: [] })).toBe(false);
  });

  it("normalizes retirements to facade model symbols", () => {
    const drafts = openaiConnector.normalizeChange({
      rawPayload: MODEL_RETIREMENT_PAYLOAD,
      sourceType: "SDK_RELEASE",
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      changeType: "METHOD_REMOVED",
      oldValue: "openai:gpt-4o",
      newValue: "openai:gpt-4o-mini",
      breaking: true,
      affectedSymbols: ["openai:gpt-4o"],
    });
  });

  it("suggests quote-preserving model swaps for facade symbols", () => {
    const drafts = openaiConnector.normalizeChange({
      rawPayload: MODEL_RETIREMENT_PAYLOAD,
      sourceType: "SDK_RELEASE",
    });
    const suggestions = openaiConnector.buildPatchSuggestions(drafts);
    expect(suggestions).toEqual([
      {
        symbol: "openai:gpt-4o",
        replacement: "openai:gpt-4o-mini",
        description: "Replace retired model 'gpt-4o' with 'gpt-4o-mini' (openai).",
        confidence: 92,
        modelUpdate: { from: "gpt-4o", to: "gpt-4o-mini" },
      },
    ]);
  });
});
