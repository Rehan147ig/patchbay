import { describe, expect, it } from "vitest";
import { methodRenameKit } from "./archetypes";
import { defineConnector } from "./sdk";

describe("methodRenameKit", () => {
  it("builds rename rules with aliases and exact-symbol suggestions", () => {
    const kit = methodRenameKit([
      {
        symbol: "client.chat.completions.create",
        replacement: "client.chat.complete",
        description: "Replace chat.completions.create with chat.complete.",
        aliases: ["mistral.chat.completions"],
        evidence: { sdk: "mistral" },
      },
    ]);

    expect(kit.rules).toHaveLength(1);
    expect(kit.rules[0]).toMatchObject({
      changeType: "METHOD_RENAMED",
      oldValue: "client.chat.completions.create",
      newValue: "client.chat.complete",
      affectedSymbols: ["client.chat.completions.create", "mistral.chat.completions"],
      breaking: true,
    });
    expect(kit.patchSuggestions).toEqual({
      "client.chat.completions.create": {
        replacement: "client.chat.complete",
        description: "Replace chat.completions.create with chat.complete.",
        confidence: 90,
      },
      "mistral.chat.completions": {
        replacement: "client.chat.complete",
        description: "Replace chat.completions.create with chat.complete.",
        confidence: 90,
      },
    });
  });

  it("drives a declarative connector end to end", () => {
    const kit = methodRenameKit([
      {
        symbol: "old.method",
        replacement: "new.method",
        description: "rename",
        confidence: 88,
      },
    ]);
    const connector = defineConnector({
      slug: "kit-driven",
      identifiers: ["kit-driven"],
      rules: kit.rules,
      patchSuggestions: kit.patchSuggestions,
    });
    const drafts = connector.normalizeChange({
      rawPayload: { sdk: "kit-driven" },
      sourceType: "SDK_RELEASE",
    });
    expect(connector.buildPatchSuggestions(drafts)).toEqual([
      {
        symbol: "old.method",
        replacement: "new.method",
        description: "rename",
        confidence: 88,
      },
    ]);
  });
});
