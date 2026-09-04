import { randomBytes } from "node:crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { ARGON2_OPTIONS } from "./agent-keys";

/**
 * Per-organization SCIM 2.0 bearer tokens. Same security contract as provider-
 * agent keys: Patchbay stores only argon2id hashes, never the plaintext, and
 * rotation keeps the previous hash for one cycle so the IdP holding the old
 * token stays authenticated until the next rotation.
 *
 * Lookup is prefix-indexed: the token embeds a short plaintext prefix
 * (`scimTokenPrefix`) that selects the single candidate organization, so each
 * request runs exactly one expensive verification instead of one per tenant.
 */

const TOKEN_PREFIX = "pb_scim_";
/** Plaintext lookup characters after the scheme prefix (128+ bits stay secret). */
const LOOKUP_CHARS = 12;

export function generateScimToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
}

/** Plaintext prefix stored on the organization for candidate lookup. */
export function scimTokenLookupPrefix(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + LOOKUP_CHARS);
}

export async function hashScimToken(token: string): Promise<string> {
  return argon2Hash(token, ARGON2_OPTIONS);
}

/**
 * Verifies against the current hash, then the previous-rotation hash.
 * Returns "current" | "previous" so callers can distinguish a live token
 * from one that should be rotated away, or null when neither matches.
 */
export async function verifyScimToken(
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
