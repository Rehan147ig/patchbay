import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { logger } from "@patchbay/domain";
import type { SecretStore, SecretStoreOptions } from "./secrets";

/**
 * Envelope encryption for secret material (WP11, spec §4.3).
 *
 * Values are stored as `enc1.<kid>.<base64(nonce|ciphertext|tag)>` envelopes
 * sealed with AES-256-GCM under a key-encryption key (KEK). The KEK ring has
 * two rotation states: PRIMARY seals new envelopes AND opens old ones, while
 * PREVIOUS only opens — so a rotation (promote the new key, demote the old)
 * never orphans already-sealed values. `rotateEnvelope` reseals a value
 * under PRIMARY without ever exposing it to the caller.
 *
 * Errors never include secret values (or key material); access events log
 * the secret NAME, key id, and hit/miss — never the value.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const MAX_PLAINTEXT_BYTES = 64 * 1024;

export const ENVELOPE_PREFIX = "enc1.";
export type KeyState = "PRIMARY" | "PREVIOUS";

export interface KekEntry {
  kid: string;
  key: Buffer;
  state: KeyState;
}

export interface KekRing {
  entries: KekEntry[];
}

const envelopeSchema = z
  .string()
  .regex(/^enc1\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9+/=]+$/, "not a Patchbay secret envelope");

/** True when the stored value is a sealed envelope (vs. plaintext passthrough). */
export function isEnvelope(value: string): boolean {
  return envelopeSchema.safeParse(value).success;
}

function kekFromEnv(name: string, source: NodeJS.ProcessEnv): Buffer | null {
  const raw = source[name];
  if (raw === undefined || raw.trim() === "") return null;
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new Error(`Secret encryption key "${name}" is not valid base64`);
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`Secret encryption key "${name}" must decode to ${KEY_BYTES} bytes (AES-256)`);
  }
  return key;
}

/**
 * Build the KEK ring from the environment. Returns null when unconfigured
 * (PATCHBAY_KEK unset) — callers fall back to plaintext with a loud warning,
 * never silent insecurity. Malformed keys throw value-free errors.
 */
export function parseKekRing(source: NodeJS.ProcessEnv = process.env): KekRing | null {
  const primary = kekFromEnv("PATCHBAY_KEK", source);
  if (!primary) return null;
  const primaryKid = source.PATCHBAY_KEK_KID?.trim() || "kek-primary";
  const entries: KekEntry[] = [{ kid: primaryKid, key: primary, state: "PRIMARY" }];
  const previous = kekFromEnv("PATCHBAY_KEK_PREVIOUS", source);
  if (previous) {
    const previousKid = source.PATCHBAY_KEK_PREVIOUS_KID?.trim() || "kek-previous";
    if (previousKid === primaryKid) {
      throw new Error(
        "Rotation kids must differ: PATCHBAY_KEK_KID equals PATCHBAY_KEK_PREVIOUS_KID",
      );
    }
    entries.push({ kid: previousKid, key: previous, state: "PREVIOUS" });
  }
  return { entries };
}

function primaryOf(ring: KekRing): KekEntry {
  const primary = ring.entries.find((entry) => entry.state === "PRIMARY");
  if (!primary) throw new Error("KEK ring has no PRIMARY key; refusing to seal");
  return primary;
}

function entryFor(ring: KekRing, kid: string): KekEntry {
  const entry = ring.entries.find((candidate) => candidate.kid === kid);
  if (!entry) {
    const known = ring.entries.map((candidate) => candidate.kid).join(", ");
    throw new Error(`Unknown envelope key id "${kid}" (known: ${known || "none"})`);
  }
  return entry;
}

/** Seal plaintext under the PRIMARY key. */
export function encryptSecret(plaintext: string, ring: KekRing): string {
  if (Buffer.byteLength(plaintext, "utf8") > MAX_PLAINTEXT_BYTES) {
    throw new Error(`Secret exceeds the ${MAX_PLAINTEXT_BYTES} byte seal limit; refusing`);
  }
  const { kid, key } = primaryOf(ring);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) throw new Error("GCM tag length mismatch; refusing to seal");
  const sealed = Buffer.concat([nonce, ciphertext, tag]).toString("base64");
  return `${ENVELOPE_PREFIX}${kid}.${sealed}`;
}

/** Open an envelope with whichever ring key its kid names (either state). */
export function decryptEnvelope(envelope: string, ring: KekRing): string {
  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new Error("Value is not a Patchbay secret envelope; refusing to open");
  const [, kid, sealed] = envelope.split(".");
  const { key } = entryFor(ring, kid as string);
  let packed: Buffer;
  try {
    packed = Buffer.from(sealed as string, "base64");
  } catch {
    throw new Error("Envelope payload is not valid base64; refusing to open");
  }
  if (packed.length < NONCE_BYTES + TAG_BYTES + 1) {
    throw new Error("Envelope payload is too short; refusing to open");
  }
  const nonce = packed.subarray(0, NONCE_BYTES);
  const tag = packed.subarray(packed.length - TAG_BYTES);
  const ciphertext = packed.subarray(NONCE_BYTES, packed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Auth failure: wrong key, tampered envelope, or corrupted store. One
    // message for all three — distinguishing them would aid an attacker.
    throw new Error("Envelope authentication failed; refusing to open");
  }
}

/** Reseal under PRIMARY (post-rotation hygiene). Content-identical, fresh nonce. */
export function rotateEnvelope(envelope: string, ring: KekRing): string {
  return encryptSecret(decryptEnvelope(envelope, ring), ring);
}

export interface SecretAccessEvent {
  name: string;
  hit: boolean;
  encrypted: boolean;
  kid: string | null;
}

/**
 * SecretStore decorator that transparently opens envelopes (WP11).
 * Plaintext values pass through untouched so adoption is gradual: seal
 * values offline with encryptSecret, store the envelope, and reads just work
 * — including across a rotation (PREVIOUS still opens). Every access emits
 * an audit event with the secret NAME only.
 */
export class EncryptedSecretStore implements SecretStore {
  private readonly audit: (event: SecretAccessEvent) => void;

  constructor(
    private readonly inner: SecretStore,
    private readonly ring: KekRing,
    options: SecretStoreOptions & { audit?: (event: SecretAccessEvent) => void } = {},
  ) {
    this.audit =
      options.audit ??
      ((event) =>
        logger.info("secret accessed", {
          name: event.name,
          hit: event.hit,
          encrypted: event.encrypted,
          kid: event.kid,
        }));
  }

  async get(name: string): Promise<string | null> {
    const raw = await this.inner.get(name);
    if (raw === null) {
      this.audit({ name, hit: false, encrypted: false, kid: null });
      return null;
    }
    if (!isEnvelope(raw)) {
      // A value wearing the envelope prefix but failing the schema is a
      // corrupted or hand-forged seal: fail closed instead of returning it
      // as if it were plaintext.
      if (raw.startsWith(ENVELOPE_PREFIX)) {
        throw new Error("Stored value has an envelope prefix but is malformed; refusing");
      }
      this.audit({ name, hit: true, encrypted: false, kid: null });
      return raw;
    }
    const kid = raw.split(".")[1] ?? null;
    const value = decryptEnvelope(raw, this.ring);
    this.audit({ name, hit: true, encrypted: true, kid });
    return value;
  }

  async getRequired(name: string): Promise<string> {
    const value = await this.get(name);
    if (value === null) {
      throw new Error(`Required secret "${name}" is not set`);
    }
    return value;
  }
}
