import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Content-addressed evidence object store (WP6).
 *
 * Raw Watchtower evidence payloads are stored verbatim on disk, keyed by the
 * SHA-256 of their content. The database keeps only metadata + the object key,
 * so an object is immutable, deduplicated by construction (same content ->
 * same key -> single write), and verifiable by re-hashing the stored file.
 * The store is a plain directory tree; a real deployment can back it with any
 * object storage that supports content-addressed keys (S3/R2/GCS) by keeping
 * the same key derivation.
 */

const DEFAULT_STORE_DIR = resolve(process.cwd(), "data", "evidence");

/**
 * Hard cap on a single evidence object. Watchtower evidence is release
 * metadata (packuments, release notes, OpenAPI specs — the largest real spec
 * is ~8 MB), never tenant source; anything larger than this is rejected
 * instead of silently growing the store. Content-addressed, so an unchanged
 * spec costs one object regardless of poll count.
 */
export const MAX_EVIDENCE_PAYLOAD_BYTES = 12 * 1024 * 1024;

export function evidenceStoreDir(): string {
  return process.env.EVIDENCE_STORE_DIR?.trim()
    ? resolve(process.env.EVIDENCE_STORE_DIR)
    : DEFAULT_STORE_DIR;
}

export function contentHashOf(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Deterministic object key for a payload hash, e.g. sha256/ab12.../ab12...json
 * (first two characters form a shard directory to avoid single-directory
 * growth).
 */
/**
 * Deterministic object key for a payload hash, e.g. sha256/ab12.../ab12...json
 * (first two characters form a shard directory to avoid single-directory
 * growth).
 */
export function objectKeyForHash(hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`invalid content hash: ${hash}`);
  }
  return `sha256/${hash.slice(0, 2)}/${hash}.json`;
}

/**
 * Delete one evidence object by key. The key must be a well-formed
 * content-addressed key (never a raw path): traversal attempts fail closed.
 * Missing files count as deleted (idempotent — retention re-runs safely).
 */
export async function deleteEvidenceObject(key: string): Promise<boolean> {
  if (!/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.json$/.test(key)) {
    throw new Error(`refusing to delete non-evidence key: ${key}`);
  }
  const dir = evidenceStoreDir();
  const target = resolve(dir, key);
  if (target !== join(dir, key) || !target.startsWith(dir)) {
    throw new Error(`refusing to delete path outside the evidence store: ${key}`);
  }
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(target);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export interface EvidenceObjectWrite {
  /** Object key (content-addressed) that was written or already present. */
  key: string;
  /** True when the object was written by this call; false when it already existed. */
  written: boolean;
  /** SHA-256 of the payload. */
  contentHash: string;
}

/**
 * Store a raw evidence payload. Idempotent: when the object already exists
 * (same hash), nothing is written and `written` is false.
 */
export async function storeRawEvidence(
  payload: string,
  options: { maxBytes?: number } = {},
): Promise<EvidenceObjectWrite> {
  // Callers may raise the cap to match their fetch profile (e.g. the OpenAPI
  // watchtower allows 16 MB responses); the default stays conservative.
  const maxBytes = options.maxBytes ?? MAX_EVIDENCE_PAYLOAD_BYTES;
  if (Buffer.byteLength(payload, "utf8") > maxBytes) {
    throw new Error(`evidence payload exceeds the ${maxBytes} byte cap; refusing to store`);
  }
  const hash = contentHashOf(payload);
  const key = objectKeyForHash(hash);
  const dir = evidenceStoreDir();
  const path = join(dir, key);
  await mkdir(join(dir, "sha256", hash.slice(0, 2)), { recursive: true });
  try {
    await writeFile(path, payload, { flag: "wx" });
    return { key, written: true, contentHash: hash };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return { key, written: false, contentHash: hash };
    }
    throw error;
  }
}

/**
 * Read a stored object. Verifies the stored content re-hashes to the key's
 * hash, so a corrupted or tampered object is detected on read.
 */
export async function readRawEvidence(key: string): Promise<string> {
  const path = join(evidenceStoreDir(), key);
  const payload = await readFile(path, "utf8");
  const expected = key.split("/").pop()?.replace(".json", "") ?? "";
  const actual = contentHashOf(payload);
  if (actual !== expected) {
    throw new Error(`evidence object ${key} failed hash verification`);
  }
  return payload;
}

export function evidenceObjectExists(key: string): boolean {
  return existsSync(join(evidenceStoreDir(), key));
}

export function objectKeyForPayload(payload: string): string {
  return objectKeyForHash(contentHashOf(payload));
}
