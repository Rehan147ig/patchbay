import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getRegistryRecipe,
  getSigningKeys,
  signRecipeWithKeyId,
  verifyRecipeSignature,
  verifyRecipeSignatureWithDetails,
} from "./registry-recipes";
import type { MigrationRecipe } from "@patchbay/domain";

const ORIGINAL_ENV = { ...process.env };

function setKeys(current: string, next?: string, currentId?: string, nextId?: string) {
  process.env.PATCH_REGISTRY_SIGNING_KEY = current;
  if (currentId) process.env.PATCH_REGISTRY_SIGNING_KEY_ID = currentId;
  else delete process.env.PATCH_REGISTRY_SIGNING_KEY_ID;
  if (next) {
    process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT = next;
    if (nextId) process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT_ID = nextId;
    else delete process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT_ID;
  } else {
    delete process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT;
    delete process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT_ID;
  }
}

describe("registry signing — single key", () => {
  beforeEach(() => {
    setKeys("test-current-key-12345", undefined, "kid_current_1");
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("signs and verifies with current key", () => {
    const recipe = getRegistryRecipe("openai", "3.3.0", "4.0.0")!;
    expect(recipe.keyId).toBe("kid_current_1");
    const result = verifyRecipeSignatureWithDetails(recipe);
    expect(result.verified).toBe(true);
    expect(result.keyId).toBe("kid_current_1");
    expect(result.rotationWindowActive).toBe(false);
    expect(verifyRecipeSignature(recipe)).toBe(true);
  });

  it("rejects tampered signature", () => {
    const recipe = getRegistryRecipe("openai", "3.3.0", "4.0.0")!;
    const tampered = { ...recipe, signature: "00".repeat(32) };
    const result = verifyRecipeSignatureWithDetails(tampered as MigrationRecipe);
    expect(result.verified).toBe(false);
    expect(result.keyId).toBeNull();
  });

  it("rejects invalid hex length", () => {
    const recipe = getRegistryRecipe("openai", "3.3.0", "4.0.0")!;
    const tampered = { ...recipe, signature: "abc" };
    expect(verifyRecipeSignature(tampered as MigrationRecipe)).toBe(false);
  });
});

describe("registry signing — rotation window (dual-key)", () => {
  beforeEach(() => {
    setKeys("current-secret-A", "next-secret-B", "kid_A", "kid_B");
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("old-key acceptance: recipe signed with current key verifies as current during window", () => {
    const keys = getSigningKeys();
    expect(keys.next?.id).toBe("kid_B");
    // getRegistryRecipe signs with current (kid_A)
    const recipe = getRegistryRecipe("stripe", "16.11.0", "16.12.0")!;
    expect(recipe.keyId).toBe("kid_A");
    const result = verifyRecipeSignatureWithDetails(recipe);
    expect(result.verified).toBe(true);
    expect(result.keyId).toBe("kid_A");
    expect(result.rotationWindowActive).toBe(true);
  });

  it("new-key acceptance: recipe signed with next key verifies as next during window", () => {
    const keys = getSigningKeys();
    const canonicalBase = {
      schemaVersion: 1 as const,
      vendor: "stripe",
      fromVersion: "16.11.0",
      toVersion: "16.12.0",
      capability: "DRAFT_PR" as const,
      certifiedAt: new Date().toISOString(),
      engineVersion: "1.0.0",
      rules: [
        {
          changeType: "SDK_VERSION_UPGRADE",
          oldValue: "16.11.0",
          newValue: "16.12.0",
          description: "test",
          trusted: true,
        },
      ],
      signatureVersion: 1 as const,
    };
    const sigNext = signRecipeWithKeyId(canonicalBase, keys.next!.id);
    const recipeNext: MigrationRecipe = {
      ...canonicalBase,
      keyId: keys.next!.id,
      signature: sigNext,
    };
    const result = verifyRecipeSignatureWithDetails(recipeNext);
    expect(result.verified).toBe(true);
    expect(result.keyId).toBe("kid_B");
    expect(result.rotationWindowActive).toBe(true);
  });

  it("invalid signatures fail even in rotation window", () => {
    const recipe = getRegistryRecipe("openai", "3.3.0", "4.0.0")!;
    const bad = { ...recipe, signature: recipe.signature.slice(0, -2) + "ff" };
    expect(verifyRecipeSignature(bad as MigrationRecipe)).toBe(false);
  });

  it("explicit keyId mismatch fails", () => {
    const keys = getSigningKeys();
    const canonicalBase = {
      schemaVersion: 1 as const,
      vendor: "openai",
      fromVersion: "3.3.0",
      toVersion: "4.0.0",
      capability: "DRAFT_PR" as const,
      certifiedAt: new Date().toISOString(),
      engineVersion: "1.0.0",
      rules: [
        {
          changeType: "SDK_VERSION_UPGRADE",
          oldValue: "3.3.0",
          newValue: "4.0.0",
          description: "test",
          trusted: true,
        },
      ],
      signatureVersion: 1 as const,
    };
    // Sign with current but claim next's keyId — should fail
    const sigCurrent = signRecipeWithKeyId(canonicalBase, keys.current.id);
    const spoofed: MigrationRecipe = {
      ...canonicalBase,
      keyId: keys.next!.id,
      signature: sigCurrent,
    };
    const result = verifyRecipeSignatureWithDetails(spoofed);
    expect(result.verified).toBe(false);
  });
});

describe("registry signing — post-rotation rejection", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("old signature rejected after rotation (old key retired)", () => {
    // Phase 1: sign with old current (kid_old)
    setKeys("old-secret-111", "new-secret-222", "kid_old", "kid_new");
    const oldRecipe = getRegistryRecipe("openai", "3.3.0", "4.0.0")!;
    expect(oldRecipe.keyId).toBe("kid_old");
    expect(verifyRecipeSignature(oldRecipe)).toBe(true);

    // Phase 2: rotate — new current = old next, old retired, no NEXT
    setKeys("new-secret-222", undefined, "kid_new");
    const resultAfterRotation = verifyRecipeSignatureWithDetails(oldRecipe);
    // Old recipe signed with kid_old should now fail because kid_old is not active
    expect(resultAfterRotation.verified).toBe(false);
    expect(resultAfterRotation.keyId).toBeNull();
    expect(resultAfterRotation.rotationWindowActive).toBe(false);

    // New recipe signed with new current should verify
    const newRecipe = getRegistryRecipe("openai", "3.3.0", "4.0.0")!;
    expect(newRecipe.keyId).toBe("kid_new");
    expect(verifyRecipeSignature(newRecipe)).toBe(true);
  });

  it("rotation retirement: next becomes current, window closes", () => {
    setKeys("k1", "k2", "kid_1", "kid_2");
    expect(getSigningKeys().next?.id).toBe("kid_2");
    setKeys("k2", undefined, "kid_2");
    const keys = getSigningKeys();
    expect(keys.current.id).toBe("kid_2");
    expect(keys.next).toBeUndefined();
    expect(
      verifyRecipeSignatureWithDetails(getRegistryRecipe("stripe", "16.11.0", "16.12.0")!)
        .rotationWindowActive,
    ).toBe(false);
  });
});

describe("registry signing — legacy compatibility", () => {
  beforeEach(() => {
    setKeys("legacy-key-xyz", undefined, "kid_legacy");
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("legacy recipe without keyId still verifies (backward compat)", () => {
    // Simulate old recipe signed before keyId field existed (no keyId in canonical)
    const legacyWithoutKeyId = {
      schemaVersion: 1 as const,
      vendor: "openai",
      fromVersion: "3.3.0",
      toVersion: "4.0.0",
      capability: "DRAFT_PR" as const,
      certifiedAt: new Date().toISOString(),
      engineVersion: "1.0.0",
      rules: [
        {
          changeType: "SDK_VERSION_UPGRADE",
          oldValue: "3.3.0",
          newValue: "4.0.0",
          description: "legacy",
          trusted: true,
        },
      ],
    };
    const sigLegacy = createHmac("sha256", "legacy-key-xyz")
      .update(JSON.stringify(legacyWithoutKeyId))
      .digest("hex");
    const legacyRecipe = {
      ...legacyWithoutKeyId,
      signature: sigLegacy,
    } as unknown as MigrationRecipe;
    expect((legacyRecipe as unknown as Record<string, unknown>).keyId).toBeUndefined();
    const result = verifyRecipeSignatureWithDetails(legacyRecipe);
    expect(result.verified).toBe(true);
    // Should map to current keyId even though recipe had no explicit id
    expect(result.keyId).toBe("kid_legacy");
  });
});

describe("signing key derivation", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("derives stable keyId when no explicit id provided", () => {
    delete process.env.PATCH_REGISTRY_SIGNING_KEY_ID;
    delete process.env.PATCH_REGISTRY_SIGNING_KEY_NEXT_ID;
    setKeys("some-random-key-material-xyz", "other-key-abc");
    const keys = getSigningKeys();
    expect(keys.current.id).toMatch(/^kid_/);
    expect(keys.next?.id).toMatch(/^kid_/);
    expect(keys.current.id).not.toBe(keys.next?.id);
  });

  it("explicit ids override derivation", () => {
    setKeys("keyA", "keyB", "explicit_A", "explicit_B");
    const keys = getSigningKeys();
    expect(keys.current.id).toBe("explicit_A");
    expect(keys.next?.id).toBe("explicit_B");
  });
});
