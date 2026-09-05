import { createHash } from "node:crypto";

/**
 * Content-addressed hashing for the contract pipeline (WP2).
 *
 * Snapshots are identified by the SHA-256 of their bytes and diffed by the
 * SHA-256 of their canonical normalized form. Canonical JSON sorts object
 * keys recursively so semantically identical payloads hash identically
 * regardless of key order; array order is significant (a reordered enum or
 * parameter list IS a different contract).
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  // undefined, functions, symbols, bigints: JSON.stringify would silently
  // drop or throw on these. Fail closed instead of hashing an ambiguous form.
  throw new Error(`canonicalJson does not support values of type ${typeof value}`);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
