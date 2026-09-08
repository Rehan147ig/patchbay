import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Immutable repository snapshot boundary (connected-repo AI pipeline).
 *
 * DB-free and network-free: this module owns ONLY filesystem identity —
 * manifest building, path-safety enforcement, and checkout verification.
 * Persistence lives in `apps/worker/src/lib/repository-snapshot.ts`; the
 * database stores immutable identifiers/hashes/timestamps/provenance, never
 * source content. The checkout path is temporary execution state (job-owned
 * temp dir, removed in `finally`).
 *
 * Fixture repositories flow through the SAME contract: the manifest is built
 * from the fixture directory with identical rules, so there is no
 * fixture-only production code path.
 */

export const MAX_SNAPSHOT_FILES = 2000;
export const MAX_SNAPSHOT_FILE_BYTES = 1_048_576;
const MAX_SNAPSHOT_PATH_CHARS = 512;

const SKIPPED_DIRS = new Set([".git", "node_modules"]);

export interface SnapshotManifestFile {
  /** Normalized posix-relative path (e.g. `src/chat/service.ts`). */
  path: string;
  size: number;
  /** Octal permission bits as a string (e.g. `644`). */
  mode: string;
  /** SHA-256 hex of the exact file bytes. */
  sha256: string;
}

export interface SnapshotManifest {
  files: SnapshotManifestFile[];
  /** SHA-256 over the canonical manifest encoding (tamper-evident identity). */
  manifestHash: string;
}

export class SnapshotPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotPathError";
  }
}

export class SnapshotVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotVerificationError";
  }
}

export class SnapshotBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotBudgetError";
  }
}

/**
 * Rejects absolute paths, traversal, empty segments, backslashes, and
 * over-long paths. Manifest paths are always posix-relative; anything else
 * is an AI or repository attempt to escape the checkout and fails closed.
 */
export function assertSafeSnapshotPath(filePath: string): string {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new SnapshotPathError("snapshot path must be a non-empty string");
  }
  if (filePath.length > MAX_SNAPSHOT_PATH_CHARS) {
    throw new SnapshotPathError(
      `snapshot path exceeds ${MAX_SNAPSHOT_PATH_CHARS} chars: ${filePath.slice(0, 64)}`,
    );
  }
  if (filePath.includes("\0")) {
    throw new SnapshotPathError("snapshot path contains NUL");
  }
  if (filePath.includes("\\")) {
    throw new SnapshotPathError(
      `snapshot path must use posix separators: ${filePath.slice(0, 64)}`,
    );
  }
  if (path.isAbsolute(filePath) || filePath.startsWith("/")) {
    throw new SnapshotPathError(`snapshot path must be relative: ${filePath.slice(0, 64)}`);
  }
  if (/^[A-Za-z]:\//.test(filePath)) {
    throw new SnapshotPathError(`snapshot path must be relative: ${filePath.slice(0, 64)}`);
  }
  const segments = filePath.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new SnapshotPathError(`snapshot path escapes the checkout: ${filePath.slice(0, 64)}`);
    }
  }
  const normalized = path.posix.normalize(filePath);
  if (normalized !== filePath) {
    throw new SnapshotPathError(`snapshot path is not normalized: ${filePath.slice(0, 64)}`);
  }
  return filePath;
}

/** SHA-256 hex of bytes (manifest + patch hashing share this helper). */
export function sha256HexOf(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical manifest identity: sorted path + size + mode + sha256. */
export function manifestHashOf(files: ReadonlyArray<SnapshotManifestFile>): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const digest = createHash("sha256");
  for (const file of sorted) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(file.mode);
    digest.update("\0");
    digest.update(file.sha256);
    digest.update("\0");
  }
  return digest.digest("hex");
}

/**
 * Builds the allowed-file manifest of a checkout directory.
 *
 * - Skips `.git` and `node_modules` (never patch targets, never stable).
 * - Symlinks escaping the checkout fail closed; interior symlinks are skipped
 *   (they are not regular patch targets).
 * - Non-regular files (sockets, fifos, devices) are skipped — they can never
 *   be AI patch targets because they never enter the manifest.
 * - Files larger than MAX_SNAPSHOT_FILE_BYTES are skipped (hash-only would
 *   still be unbounded context; targeting one invalidates the plan safely).
 * - Output is sorted by path; the manifest hash is tamper-evident.
 */
export function buildSnapshotManifest(rootDir: string): SnapshotManifest {
  const rootAbs = path.resolve(rootDir);
  const rootReal = realpathSync(rootAbs);
  const files: SnapshotManifestFile[] = [];

  const walk = (dirAbs: string): void => {
    const entries = readdirSync(dirAbs, { withFileTypes: true });
    // Sorted for determinism across filesystems.
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of sorted) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      const fullAbs = path.join(dirAbs, entry.name);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(fullAbs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) {
        let targetReal: string;
        try {
          targetReal = realpathSync(fullAbs);
        } catch {
          throw new SnapshotPathError(`unresolvable symlink rejected: ${entry.name}`);
        }
        if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
          throw new SnapshotPathError(`symlink escapes the checkout: ${entry.name}`);
        }
        // Interior symlink: not a regular patch target — skip without failing.
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullAbs);
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > MAX_SNAPSHOT_FILE_BYTES) continue;
      const relative = path.relative(rootAbs, fullAbs).split(path.sep).join("/");
      assertSafeSnapshotPath(relative);
      let bytes: Buffer;
      try {
        bytes = readFileSync(fullAbs);
      } catch {
        continue;
      }
      // Size re-check after read (TOCTOU guard against growth between lstat/read).
      if (bytes.length > MAX_SNAPSHOT_FILE_BYTES) continue;
      files.push({
        path: relative,
        size: bytes.length,
        mode: (stat.mode & 0o777).toString(8),
        sha256: sha256HexOf(bytes),
      });
      if (files.length > MAX_SNAPSHOT_FILES) {
        throw new SnapshotBudgetError(
          `snapshot exceeds ${MAX_SNAPSHOT_FILES} files; refusing an unbounded manifest`,
        );
      }
    }
  };

  walk(rootAbs);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, manifestHash: manifestHashOf(files) };
}

/** Map view of a manifest for O(1) binding (path -> sha256). */
export function manifestHashMap(manifest: SnapshotManifest): Map<string, string> {
  return new Map(manifest.files.map((file) => [file.path, file.sha256]));
}

export interface ExpectedCheckoutIdentity {
  commitSha: string;
  treeHash: string;
  manifestHash: string;
}

export interface ActualCheckoutIdentity {
  commitSha: string;
  treeHash: string;
  manifest: SnapshotManifest;
}

/**
 * Fails closed when the fetched checkout does not match the snapshot that was
 * analyzed: wrong commit SHA, wrong tree hash, or manifest drift (a file was
 * added/removed/changed between analysis and application). Never trusts an
 * old local path — callers re-checkout the same exact commit and call this.
 */
export function verifySnapshotCheckout(
  expected: ExpectedCheckoutIdentity,
  actual: ActualCheckoutIdentity,
): void {
  if (actual.commitSha !== expected.commitSha) {
    throw new SnapshotVerificationError(
      `snapshot commit mismatch: expected ${expected.commitSha.slice(0, 12)}, got ${actual.commitSha.slice(0, 12)}`,
    );
  }
  if (actual.treeHash !== expected.treeHash) {
    throw new SnapshotVerificationError(
      `snapshot tree mismatch at ${expected.commitSha.slice(0, 12)}: expected tree ${expected.treeHash.slice(0, 12)}, got ${actual.treeHash.slice(0, 12)}`,
    );
  }
  if (actual.manifest.manifestHash !== expected.manifestHash) {
    throw new SnapshotVerificationError(
      `snapshot manifest drift at ${expected.commitSha.slice(0, 12)}: checkout no longer matches the analyzed snapshot`,
    );
  }
}

/**
 * Runs `work` against a checkout directory and ALWAYS removes the directory
 * afterwards (success, failure, or throw). The snapshot checkout path is
 * temporary execution state only — this helper is the single place that
 * enforces the `finally` cleanup contract (test: cleanup runs both ways).
 */
export async function withSnapshotCheckout<T>(
  checkoutDir: string,
  work: (rootDir: string) => Promise<T> | T,
): Promise<T> {
  try {
    return await work(checkoutDir);
  } finally {
    try {
      rmSync(checkoutDir, { recursive: true, force: true });
    } catch {
      // Cleanup failures must never mask the work result.
    }
  }
}
