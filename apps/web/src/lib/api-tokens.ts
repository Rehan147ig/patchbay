import { randomBytes } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { ARGON2_OPTIONS } from "./agent-keys";

/**
 * Generic per-organization bearer tokens (`pb_<scheme>_…`). Same security
 * contract as provider-agent keys: only argon2id hashes are stored, rotation
 * keeps the previous hash for one cycle, and a plaintext lookup prefix
 * selects the single candidate row so each request runs exactly one expensive
 * verification. SCIM (`pb_scim_`) and audit-export (`pb_audit_`) tokens are
 * thin flavors of this scheme.
 */

/** Plaintext lookup characters after the scheme prefix (128+ bits stay secret). */
const LOOKUP_CHARS = 12;

export function generateApiToken(schemePrefix: string): string {
  return `${schemePrefix}${randomBytes(24).toString("base64url")}`;
}

/** Plaintext prefix stored for candidate lookup. */
export function apiTokenLookupPrefix(token: string, schemePrefix: string): string {
  return token.slice(0, schemePrefix.length + LOOKUP_CHARS);
}

export async function hashApiToken(token: string): Promise<string> {
  return argon2Hash(token, ARGON2_OPTIONS);
}

/**
 * Verifies against the current hash, then the previous-rotation hash.
 * Returns "current" | "previous" | null.
 */
export async function verifyApiToken(
  provided: string,
  currentHash: string | null,
  previousHash: string | null,
): Promise<"current" | "previous" | null> {
  if (currentHash && (await argon2VerifySafe(provided, currentHash))) return "current";
  if (previousHash && (await argon2VerifySafe(provided, previousHash))) return "previous";
  return null;
}

async function argon2VerifySafe(provided: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith("$argon2id$")) return false;
  try {
    return await argon2Verify(storedHash, provided);
  } catch {
    return false;
  }
}
