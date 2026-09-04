import { apiTokenLookupPrefix, generateApiToken, hashApiToken, verifyApiToken } from "./api-tokens";

/**
 * Per-organization audit-export bearer tokens (`pb_audit_…`) for SOC
 * automation against GET /api/audit/export. Thin flavor of the generic
 * per-org token scheme in api-tokens.ts: argon2id hashes only, prefix-indexed
 * lookup, one-rotation grace.
 */

const SCHEME_PREFIX = "pb_audit_";

export function generateAuditExportToken(): string {
  return generateApiToken(SCHEME_PREFIX);
}

export function auditExportTokenLookupPrefix(token: string): string {
  return apiTokenLookupPrefix(token, SCHEME_PREFIX);
}

export async function hashAuditExportToken(token: string): Promise<string> {
  return hashApiToken(token);
}

export async function verifyAuditExportToken(
  provided: string,
  currentHash: string | null,
  previousHash: string | null,
): Promise<"current" | "previous" | null> {
  return verifyApiToken(provided, currentHash, previousHash);
}
