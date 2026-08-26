import { describe, expect, it } from "vitest";
import { getConnector } from "../registry";
import { openaiPythonConnector } from "./openai-python";

const MIGRATION_PAYLOAD = {
  sdk: "openai-python",
  fromVersion: "0.x",
  toVersion: "1.x",
  migration: {
    methodRenames: [
      { from: "openai.ChatCompletion.create", to: "client.chat.completions.create" },
      { from: "openai.Completion.create", to: "client.completions.create" },
    ],
  },
};

describe("openai-python connector", () => {
  it("is registered under its own slug", () => {
    expect(getConnector("openai-python")).toBe(openaiPythonConnector);
  });

  it("supports openai-python payloads via sdk or vendor and rejects others", () => {
    expect(openaiPythonConnector.supports(MIGRATION_PAYLOAD)).toBe(true);
    expect(openaiPythonConnector.supports({ ...MIGRATION_PAYLOAD, sdk: "openai-python" })).toBe(
      true,
    );
    expect(
      openaiPythonConnector.supports({
        ...MIGRATION_PAYLOAD,
        sdk: undefined,
        vendor: "openai-python",
      }),
    ).toBe(true);
    // The Node SDK payload must stay with the openai connector.
    expect(openaiPythonConnector.supports({ ...MIGRATION_PAYLOAD, sdk: "openai" })).toBe(false);
    expect(openaiPythonConnector.supports({ sdk: "stripe", version: "8.0.0" })).toBe(false);
    // Identifier alone without migration/version facts is not a migration payload.
    expect(openaiPythonConnector.supports({ sdk: "openai-python" })).toBe(false);
  });

  it("normalizes the v0->v1 migration into an upgrade note plus breaking renames", () => {
    const drafts = openaiPythonConnector.normalizeChange({
      rawPayload: MIGRATION_PAYLOAD,
      sourceType: "SDK_RELEASE",
    });
    const upgrade = drafts.find((draft) => draft.changeType === "SDK_VERSION_UPGRADE");
    expect(upgrade?.breaking).toBe(false);
    const renames = drafts.filter((draft) => draft.changeType === "METHOD_RENAMED");
    expect(renames).toHaveLength(2);
    expect(renames[0]?.affectedSymbols).toEqual(["openai.ChatCompletion.create"]);
    expect(renames[0]?.evidence).toMatchObject({
      sdk: "openai-python",
      rule: "module-call-to-client",
    });
  });

  it("emits no patch suggestions: Python is ASSESS-only (demoted)", () => {
    const drafts = openaiPythonConnector.normalizeChange({
      rawPayload: MIGRATION_PAYLOAD,
      sourceType: "SDK_RELEASE",
    });
    expect(openaiPythonConnector.buildPatchSuggestions(drafts)).toEqual([]);
  });

  it("emits no patch suggestions without migration rules (negative releases stay silent)", () => {
    const drafts = openaiPythonConnector.normalizeChange({
      rawPayload: { sdk: "openai-python", fromVersion: "0.x", toVersion: "1.x" },
      sourceType: "SDK_RELEASE",
    });
    expect(drafts.some((draft) => draft.changeType === "SDK_VERSION_UPGRADE")).toBe(true);
    expect(openaiPythonConnector.buildPatchSuggestions(drafts)).toEqual([]);
  });

  it("ignores malformed rename entries", () => {
    const drafts = openaiPythonConnector.normalizeChange({
      rawPayload: {
        sdk: "openai-python",
        migration: { methodRenames: [{ from: "", to: "client.completions.create" }] },
      },
      sourceType: "SDK_RELEASE",
    });
    expect(drafts.filter((draft) => draft.changeType === "METHOD_RENAMED")).toHaveLength(0);
  });
});
