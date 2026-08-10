import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generateAgentKey, hashAgentKey, verifyAgentKey } from "./agent-keys";

describe("agent-keys", () => {
  it("generates a prefixed, unique key", () => {
    const key = generateAgentKey();
    expect(key.startsWith("pb_agent_")).toBe(true);
    expect(key).not.toBe(generateAgentKey());
  });

  it("hashes with argon2id and verifies in constant time", async () => {
    const key = generateAgentKey();
    const hash = await hashAgentKey(key);
    expect(hash.startsWith("$argon2id$v=19$")).toBe(true);
    expect(hash).not.toContain(key);
    expect(await verifyAgentKey(key, hash)).toBe(true);
    expect(await verifyAgentKey("wrong-key", hash)).toBe(false);
    expect(await verifyAgentKey(key, await hashAgentKey("another-key"))).toBe(false);
  });

  it("verifies legacy sha256 hashes during the migration window", async () => {
    const key = generateAgentKey();
    const legacyHash = createHash("sha256").update(key).digest("hex");
    expect(await verifyAgentKey(key, legacyHash)).toBe(true);
    expect(await verifyAgentKey("wrong-key", legacyHash)).toBe(false);
  });

  it("produces distinct hashes for the same key (random salt)", async () => {
    const key = generateAgentKey();
    expect(await hashAgentKey(key)).not.toBe(await hashAgentKey(key));
  });
});
