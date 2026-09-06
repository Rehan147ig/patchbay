import { describe, expect, it } from "vitest";
import {
  decryptEnvelope,
  EncryptedSecretStore,
  encryptSecret,
  isEnvelope,
  parseKekRing,
  rotateEnvelope,
  type KekRing,
  type SecretAccessEvent,
} from "./envelope";
import { EnvSecretStore } from "./secrets";

const PRIMARY = Buffer.alloc(32, 7).toString("base64");
const PREVIOUS = Buffer.alloc(32, 9).toString("base64");

function ring(source: Record<string, string> = {}): KekRing {
  const parsed = parseKekRing({
    PATCHBAY_KEK: PRIMARY,
    PATCHBAY_KEK_PREVIOUS: PREVIOUS,
    ...source,
  });
  if (!parsed) throw new Error("expected a ring");
  return parsed;
}

describe("parseKekRing", () => {
  it("returns null when unconfigured (plaintext fallback is explicit)", () => {
    expect(parseKekRing({})).toBeNull();
    expect(parseKekRing({ PATCHBAY_KEK: "  " })).toBeNull();
  });

  it("builds a two-state ring with default kids", () => {
    const parsed = ring();
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toMatchObject({ kid: "kek-primary", state: "PRIMARY" });
    expect(parsed.entries[1]).toMatchObject({ kid: "kek-previous", state: "PREVIOUS" });
  });

  it("rejects malformed keys with value-free errors", () => {
    // Node's base64 decoder is lenient (skips invalid chars), so garbage
    // still decodes — just to the wrong length. Either way it fails closed.
    expect(() => parseKekRing({ PATCHBAY_KEK: "not-base64!!!" })).toThrow(/32 bytes/);
    expect(() => parseKekRing({ PATCHBAY_KEK: Buffer.alloc(16, 1).toString("base64") })).toThrow(
      /must decode to 32 bytes/,
    );
    expect(() => ring({ PATCHBAY_KEK_KID: "same", PATCHBAY_KEK_PREVIOUS_KID: "same" })).toThrow(
      /must differ/,
    );
  });
});

describe("envelope round-trip", () => {
  it("seals and opens under PRIMARY", () => {
    const sealed = encryptSecret("s3cr3t-value", ring());
    expect(isEnvelope(sealed)).toBe(true);
    expect(sealed.startsWith("enc1.kek-primary.")).toBe(true);
    expect(decryptEnvelope(sealed, ring())).toBe("s3cr3t-value");
  });

  it("uses fresh nonces (no two seals alike)", () => {
    const r = ring();
    expect(encryptSecret("same", r)).not.toBe(encryptSecret("same", r));
  });

  it("opens PREVIOUS-sealed envelopes after rotation", () => {
    const oldRing = ring();
    const sealed = encryptSecret("legacy", oldRing);
    // Rotate: previous PRIMARY becomes PREVIOUS, fresh PRIMARY takes over.
    const rotated = parseKekRing({
      PATCHBAY_KEK: Buffer.alloc(32, 11).toString("base64"),
      PATCHBAY_KEK_KID: "kek-next",
      PATCHBAY_KEK_PREVIOUS: PRIMARY,
      PATCHBAY_KEK_PREVIOUS_KID: "kek-primary",
    })!;
    expect(decryptEnvelope(sealed, rotated)).toBe("legacy");
  });

  it("reseals to PRIMARY on rotate", () => {
    const r = ring();
    const resealed = rotateEnvelope(encryptSecret("v", r), r);
    expect(resealed.startsWith("enc1.kek-primary.")).toBe(true);
    expect(decryptEnvelope(resealed, r)).toBe("v");
  });

  it("fails closed on unknown kids, tampering, and wrong keys", () => {
    const r = ring();
    const sealed = encryptSecret("v", r);
    expect(() => decryptEnvelope(sealed.replace("kek-primary", "kek-ghost"), r)).toThrow(
      /Unknown envelope key id/,
    );
    // Flip a ciphertext byte: GCM auth must fail, not decrypt garbage.
    const parts = sealed.split(".");
    const packed = Buffer.from(parts[2]!, "base64");
    packed[20]! ^= 0xff;
    expect(() =>
      decryptEnvelope(`${parts[0]}.${parts[1]}.${packed.toString("base64")}`, r),
    ).toThrow(/authentication failed/);
    const other = parseKekRing({ PATCHBAY_KEK: Buffer.alloc(32, 13).toString("base64") })!;
    expect(() => decryptEnvelope(sealed, other)).toThrow(
      /Unknown envelope key id|authentication failed/,
    );
    expect(() => decryptEnvelope("plain-value", r)).toThrow(/not a Patchbay secret envelope/);
  });

  it("refuses oversized plaintext", () => {
    expect(() => encryptSecret("x".repeat(65 * 1024), ring())).toThrow(/seal limit/);
  });
});

describe("EncryptedSecretStore", () => {
  function storeWith(source: Record<string, string>, events: SecretAccessEvent[]) {
    return new EncryptedSecretStore(new EnvSecretStore({ source } as never), ring(), {
      audit: (event) => events.push(event),
    });
  }

  it("opens envelopes and passes plaintext through during migration", async () => {
    const r = ring();
    const events: SecretAccessEvent[] = [];
    const store = storeWith(
      { SEALED: encryptSecret("hidden", r), PLAIN: "visible", EMPTY: "  " },
      events,
    );
    await expect(store.get("SEALED")).resolves.toBe("hidden");
    await expect(store.get("PLAIN")).resolves.toBe("visible");
    await expect(store.get("EMPTY")).resolves.toBeNull();
    await expect(store.get("MISSING")).resolves.toBeNull();
    await expect(store.getRequired("SEALED")).resolves.toBe("hidden");
    await expect(store.getRequired("MISSING")).rejects.toThrow(/not set/);
    expect(events).toEqual([
      { name: "SEALED", hit: true, encrypted: true, kid: "kek-primary" },
      { name: "PLAIN", hit: true, encrypted: false, kid: null },
      { name: "EMPTY", hit: false, encrypted: false, kid: null },
      { name: "MISSING", hit: false, encrypted: false, kid: null },
      { name: "SEALED", hit: true, encrypted: true, kid: "kek-primary" },
      { name: "MISSING", hit: false, encrypted: false, kid: null },
    ]);
  });

  it("never leaks values into audit events or errors", async () => {
    const events: SecretAccessEvent[] = [];
    const store = storeWith({ SEALED: encryptSecret("top-secret-value", ring()) }, events);
    await store.get("SEALED");
    expect(JSON.stringify(events)).not.toContain("top-secret-value");
    const broken = storeWith({ BROKEN: "enc1.kek-primary.!!!not-base64!!!" }, events);
    const error = await broken.get("BROKEN").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/malformed/);
    expect(String((error as Error).message)).not.toContain("top-secret-value");
  });
});
