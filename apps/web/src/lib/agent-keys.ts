import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

/**
 * Provider-agent API keys: Patchbay only ever stores a hash, never the
 * plaintext. Keys are hashed with argon2id (memory-hard, resists GPU/ASIC
 * cracking); hashes from before the argon2 migration (plain sha256 hex) are
 * still verified during a transition window so agents are not cut off until
 * an ADMIN rotates the key.
 */

const ARGON2_OPTIONS = {
  memoryCost: 32 * 1024, // 32 MiB
  timeCost: 3,
  parallelism: 1,
};

export async function hashAgentKey(key: string): Promise<string> {
  return argon2Hash(key, ARGON2_OPTIONS);
}

export function generateAgentKey(): string {
  return `pb_agent_${randomBytes(24).toString("base64url")}`;
}

export async function verifyAgentKey(provided: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith("$argon2id$")) {
    return argon2Verify(storedHash, provided);
  }
  return verifyLegacySha256(provided, storedHash);
}

function verifyLegacySha256(provided: string, storedHash: string): boolean {
  const providedHash = Buffer.from(createHash("sha256").update(provided).digest("hex"), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (providedHash.length !== stored.length) return false;
  return timingSafeEqual(providedHash, stored);
}

/** True when the stored hash is a legacy sha256 that should be rotated away. */
export function isLegacyAgentKeyHash(storedHash: string): boolean {
  return !storedHash.startsWith("$argon2id$");
}
