import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Provider-agent API keys: Patchbay only ever stores a sha256 hash, never the
 * plaintext (mirrors the audit/redaction rule for credentials).
 */
export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateAgentKey(): string {
  return `pb_agent_${randomBytes(24).toString("base64url")}`;
}

export function verifyAgentKey(provided: string, storedHash: string): boolean {
  const providedHash = Buffer.from(hashAgentKey(provided), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (providedHash.length !== stored.length) return false;
  return timingSafeEqual(providedHash, stored);
}
