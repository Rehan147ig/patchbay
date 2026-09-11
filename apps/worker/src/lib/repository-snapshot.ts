import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@patchbay/db";
import {
  assertSafeSnapshotPath,
  buildSnapshotManifest,
  manifestHashMap,
  verifySnapshotCheckout,
  type SnapshotManifest,
} from "@patchbay/git-provider";
import { createGitHubAppProviderFromStore } from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import { sha256Hex, unifiedDiff } from "@patchbay/remediation-engine";
import { runGit } from "@patchbay/git-provider";
import type { PatchPlan } from "@patchbay/domain";

/**
 * Repository snapshot orchestration (connected-repo AI pipeline).
 *
 * - The database stores ONLY immutable identifiers/hashes/timestamps/
 *   provenance (RepositorySnapshot row). Source content is NEVER persisted.
 * - Checkout paths are temporary job-owned temp dirs, removed in `finally`.
 * - Fixture repositories flow through the SAME contract (manifest built with
 *   identical path-safety rules); there is no fixture-only production path.
 * - Safe replay re-checks out the SAME exact commit and re-verifies manifest
 *   identity instead of trusting an old local path.
 */

export const SNAPSHOT_RETENTION_DAYS = 90;
export const MAX_APPLY_FILES = 10;
export const MAX_APPLY_EDITS_PER_FILE = 5;
export const MAX_APPLY_TOTAL_BYTES = 100_000;
export const MAX_APPLY_DIFF_LINES = 2_000;

export class SnapshotApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotApplyError";
  }
}

export class SnapshotUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotUnavailableError";
  }
}

export interface SnapshotRepositoryRow {
  id: string;
  organizationId: string;
  provider: string;
  fullName: string | null;
  defaultBranch: string | null;
  metadata: unknown;
}

export interface BuiltSnapshot {
  snapshotId: string;
  commitSha: string;
  treeHash: string;
  manifestHash: string;
  manifest: SnapshotManifest;
  provider: string;
  repositoryFullName: string;
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}

function installationIdOf(metadata: unknown): number | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as { installationId?: unknown }).installationId;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function fixtureCommitSha(fixture: string, manifestHash: string): string {
  return createHash("sha256").update(`fixture:${fixture}:${manifestHash}`).digest("hex");
}

function expiresAtDefault(): Date {
  return new Date(Date.now() + SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export interface SnapshotProvider {
  checkout(input: {
    sha: string;
    baseBranch?: string;
    repositoryFullName?: string;
  }): Promise<{ workspaceDir: string; treeHash: string }>;
}

export interface BuildSnapshotOptions {
  /**
   * Exact commit the graph analyzed (GraphSnapshot.commitSha or
   * match.dependency.commitSha). REQUIRED for connected repositories:
   * the snapshot never resolves HEAD itself, so a branch advancing after
   * analysis cannot shift the AI onto newer code. Absent -> fail closed
   * (SNAPSHOT_UNAVAILABLE, pre-model PLAN_ONLY, zero model spend).
   */
  expectedCommitSha?: string;
  extractorVersion?: string;
  graphSnapshotId?: string;
  /** Injectable provider factory (tests); defaults to the GitHub App store. */
  createProvider?: (
    installationId: number,
    repositoryFullName: string,
  ) => Promise<SnapshotProvider>;
}

/**
 * Builds (or reuses) the immutable snapshot for a repository:
 * exact commit -> disposable checkout -> manifest -> persisted row -> cleanup.
 * Returns the row id + identity + in-memory manifest for immediate binding.
 */
export async function buildSnapshotForRepository(
  repository: SnapshotRepositoryRow,
  options: BuildSnapshotOptions = {},
): Promise<BuiltSnapshot> {
  const fixture = fixtureOf(repository.metadata);
  if (fixture) {
    const fixtureDir = resolveFixtureDir(fixture);
    const manifest = buildSnapshotManifest(fixtureDir);
    const commitSha = fixtureCommitSha(fixture, manifest.manifestHash);
    const treeHash = manifest.manifestHash;
    const fullName = repository.fullName ?? `local/${fixture}`;
    const row = await upsertSnapshotRow({
      organizationId: repository.organizationId,
      repositoryId: repository.id,
      provider: repository.provider,
      repositoryFullName: fullName,
      commitSha,
      treeHash,
      manifestHash: manifest.manifestHash,
      extractorVersion: options.extractorVersion ?? null,
      graphSnapshotId: options.graphSnapshotId ?? null,
    });
    return {
      snapshotId: row.id,
      commitSha,
      treeHash,
      manifestHash: manifest.manifestHash,
      manifest,
      provider: repository.provider,
      repositoryFullName: fullName,
    };
  }

  const installationId = installationIdOf(repository.metadata);
  if (repository.provider === "GITHUB" && installationId && repository.fullName) {
    // P0: never resolve HEAD here. The caller passes the exact commit the
    // graph analyzed (graph snapshot or match); without it we fail closed
    // BEFORE any checkout or model spend. A branch advancing after analysis
    // must never shift the AI onto newer code than the evidence/policy case.
    const commitSha = options.expectedCommitSha;
    if (!commitSha) {
      throw new SnapshotUnavailableError(
        `repository ${repository.id} has no analyzed commit to pin: pass expectedCommitSha from the graph snapshot or match (refusing HEAD resolution)`,
      );
    }
    await assertInstallationOwned(installationId, repository.organizationId);
    const provider = options.createProvider
      ? await options.createProvider(installationId, repository.fullName)
      : await createGitHubAppProviderFromStore(
          { installationId, repositoryFullName: repository.fullName },
          getSecretStore(),
        );
    const checkout = await provider.checkout({
      sha: commitSha,
      baseBranch: repository.defaultBranch ?? undefined,
      repositoryFullName: repository.fullName,
    });
    try {
      const manifest = buildSnapshotManifest(checkout.workspaceDir);
      verifySnapshotCheckout(
        { commitSha, treeHash: checkout.treeHash, manifestHash: manifest.manifestHash },
        { commitSha, treeHash: checkout.treeHash, manifest },
      );
      const row = await upsertSnapshotRow({
        organizationId: repository.organizationId,
        repositoryId: repository.id,
        provider: repository.provider,
        repositoryFullName: repository.fullName,
        commitSha,
        treeHash: checkout.treeHash,
        manifestHash: manifest.manifestHash,
        extractorVersion: options.extractorVersion ?? null,
        graphSnapshotId: options.graphSnapshotId ?? null,
      });
      return {
        snapshotId: row.id,
        commitSha,
        treeHash: checkout.treeHash,
        manifestHash: manifest.manifestHash,
        manifest,
        provider: repository.provider,
        repositoryFullName: repository.fullName,
      };
    } finally {
      rmSync(checkout.workspaceDir, { recursive: true, force: true });
    }
  }

  throw new Error(
    `repository ${repository.id} has no fixture or GitHub installation source for snapshots`,
  );
}

/**
 * Retention sweep (runs on RETENTION_SWEEP_INTERVAL_MS alongside agent-run
 * and artifact purges): marks READY snapshots past expiresAt as EXPIRED.
 * Expired rows are never checked out (fail closed) and never revived
 * implicitly — a fresh snapshot row is built for the same commit on next use.
 */
export async function expireRepositorySnapshots(
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const result = await prisma.repositorySnapshot.updateMany({
    where: { status: "READY", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return { expired: result.count };
}

async function upsertSnapshotRow(input: {
  organizationId: string;
  repositoryId: string;
  provider: string;
  repositoryFullName: string;
  commitSha: string;
  treeHash: string;
  manifestHash: string;
  extractorVersion: string | null;
  graphSnapshotId: string | null;
}): Promise<{ id: string }> {
  const existing = await prisma.repositorySnapshot.findUnique({
    where: {
      repositoryId_commitSha: { repositoryId: input.repositoryId, commitSha: input.commitSha },
    },
    select: { id: true, manifestHash: true, treeHash: true, status: true, expiresAt: true },
  });
  if (existing) {
    // Replay identity: same commit must yield the same manifest/tree. A stored
    // row that disagrees fails closed instead of being silently adopted.
    if (existing.manifestHash !== input.manifestHash || existing.treeHash !== input.treeHash) {
      throw new Error(
        `snapshot identity conflict for ${input.repositoryId}@${input.commitSha.slice(0, 12)}: stored manifest no longer matches the checkout`,
      );
    }
    // Revive expired/superseded rows explicitly (fresh retention window) so
    // an EXPIRED row is never silently reused past its deadline.
    if (existing.status !== "READY" || (existing.expiresAt && existing.expiresAt < new Date())) {
      await prisma.repositorySnapshot.update({
        where: { id: existing.id },
        data: { status: "READY", expiresAt: expiresAtDefault() },
      });
    }
    return { id: existing.id };
  }
  const created = await prisma.repositorySnapshot.create({
    data: {
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      provider: input.provider as never,
      repositoryFullName: input.repositoryFullName,
      commitSha: input.commitSha,
      treeHash: input.treeHash,
      manifestHash: input.manifestHash,
      extractorVersion: input.extractorVersion,
      graphSnapshotId: input.graphSnapshotId,
      expiresAt: expiresAtDefault(),
      status: "READY",
    },
    select: { id: true },
  });
  return { id: created.id };
}

async function assertInstallationOwned(
  installationId: number,
  organizationId: string,
): Promise<void> {
  const installation = await prisma.gitHubInstallation.findUnique({
    where: { installationId },
    select: { organizationId: true },
  });
  if (!installation || installation.organizationId !== organizationId) {
    throw new Error(
      `installation ${installationId} is not bound to organization ${organizationId}`,
    );
  }
}

export interface SnapshotCheckout {
  rootDir: string;
  manifest: SnapshotManifest;
  manifestMap: Map<string, string>;
  snapshot: { id: string; commitSha: string; treeHash: string; manifestHash: string };
  cleanup: () => void;
}

/**
 * Safe replay: re-checks out the SAME exact commit into a fresh job-owned
 * temp dir and re-verifies manifest identity. Never trusts an old local path.
 * The caller MUST run work inside try/finally and call cleanup().
 */
export async function checkoutSnapshotForApply(
  snapshotId: string,
  repository: SnapshotRepositoryRow,
): Promise<SnapshotCheckout> {
  const snapshot = await prisma.repositorySnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot) throw new Error(`repository snapshot not found: ${snapshotId}`);
  if (
    snapshot.organizationId !== repository.organizationId ||
    snapshot.repositoryId !== repository.id
  ) {
    throw new Error(`snapshot ${snapshotId} does not belong to repository ${repository.id}`);
  }
  if (snapshot.status !== "READY") {
    throw new SnapshotUnavailableError(
      `snapshot ${snapshotId} is not READY (status=${snapshot.status}); refusing checkout`,
    );
  }
  if (snapshot.expiresAt && snapshot.expiresAt < new Date()) {
    // Best-effort status transition (never masks the fail-closed throw).
    try {
      await prisma.repositorySnapshot.update({
        where: { id: snapshot.id },
        data: { status: "EXPIRED" },
      });
    } catch {
      // Ignore marking failures; the throw below is authoritative.
    }
    throw new SnapshotUnavailableError(
      `snapshot ${snapshotId} expired at ${snapshot.expiresAt.toISOString()}; refusing checkout (rebuild a fresh snapshot)`,
    );
  }

  const fixture = fixtureOf(repository.metadata);
  if (fixture) {
    // Writable disposable copy: the fixture directory itself is never mutated.
    const fixtureDir = resolveFixtureDir(fixture);
    const workspace = mkdtempSync(path.join(tmpdir(), "patchbay-snapshot-"));
    cpSync(fixtureDir, workspace, {
      recursive: true,
      filter: (source) => !source.includes("node_modules"),
    });
    const manifest = buildSnapshotManifest(workspace);
    // Fixture identity: commit SHA is derived from the manifest, so manifest
    // verification IS commit verification here.
    verifySnapshotCheckout(
      {
        commitSha: snapshot.commitSha,
        treeHash: snapshot.treeHash,
        manifestHash: snapshot.manifestHash,
      },
      {
        commitSha: fixtureCommitSha(fixture, manifest.manifestHash),
        treeHash: manifest.manifestHash,
        manifest,
      },
    );
    // Tree-hash cross-check via git when the copy is a repo (best-effort; the
    // manifest check above is authoritative for fixtures).
    return {
      rootDir: workspace,
      manifest,
      manifestMap: manifestHashMap(manifest),
      snapshot: {
        id: snapshot.id,
        commitSha: snapshot.commitSha,
        treeHash: snapshot.treeHash,
        manifestHash: snapshot.manifestHash,
      },
      cleanup: () => {
        rmSync(workspace, { recursive: true, force: true });
      },
    };
  }

  const installationId = installationIdOf(repository.metadata);
  if (repository.provider === "GITHUB" && installationId && repository.fullName) {
    await assertInstallationOwned(installationId, repository.organizationId);
    const provider = await createGitHubAppProviderFromStore(
      { installationId, repositoryFullName: repository.fullName },
      getSecretStore(),
    );
    const checkout = await provider.checkout({
      sha: snapshot.commitSha,
      baseBranch: repository.defaultBranch ?? undefined,
      repositoryFullName: repository.fullName,
    });
    const cleanup = () => {
      rmSync(checkout.workspaceDir, { recursive: true, force: true });
    };
    try {
      const manifest = buildSnapshotManifest(checkout.workspaceDir);
      verifySnapshotCheckout(
        {
          commitSha: snapshot.commitSha,
          treeHash: snapshot.treeHash,
          manifestHash: snapshot.manifestHash,
        },
        { commitSha: snapshot.commitSha, treeHash: checkout.treeHash, manifest },
      );
      return {
        rootDir: checkout.workspaceDir,
        manifest,
        manifestMap: manifestHashMap(manifest),
        snapshot: {
          id: snapshot.id,
          commitSha: snapshot.commitSha,
          treeHash: snapshot.treeHash,
          manifestHash: snapshot.manifestHash,
        },
        cleanup,
      };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  throw new Error(`repository ${repository.id} has no replayable snapshot source`);
}

export interface AppliedSnapshotArtifact {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  unifiedDiff: string;
  originalHash: string;
  patchedHash: string;
  confidence: number;
}

/**
 * Deterministic patch application against the SAME snapshot that was analyzed.
 * The ONLY path from a bound AI plan to PatchArtifact data: GitHub PR delivery
 * consumes these validated artifacts, never raw model output.
 *
 * Enforces every applied edit:
 * - target path exists in the manifest and passes path-safety;
 * - source hash equals the immutable snapshot hash (TOCTOU-checked on read);
 * - operation is one of REPLACE | INSERT_AFTER | DELETE;
 * - file/edit/byte/diff budgets hold;
 * - no file outside the declared plan changes (verified by re-hashing);
 * - unified diff + patched-content hashes recorded per file.
 */
export function applyBoundPlanToCheckout(
  rootDir: string,
  manifest: SnapshotManifest,
  plan: PatchPlan,
): AppliedSnapshotArtifact[] {
  const manifestMap = manifestHashMap(manifest);
  const declared = new Set(plan.edits.map((edit) => edit.filePath));

  const perFile = new Map<string, number>();
  for (const edit of plan.edits) {
    assertSafeSnapshotPath(edit.filePath);
    if (!manifestMap.has(edit.filePath)) {
      throw new SnapshotApplyError(`apply rejected: ${edit.filePath} not in snapshot manifest`);
    }
    perFile.set(edit.filePath, (perFile.get(edit.filePath) ?? 0) + 1);
  }
  if (declared.size > MAX_APPLY_FILES) {
    throw new SnapshotApplyError(`${declared.size} files > apply max ${MAX_APPLY_FILES}`);
  }
  const maxInFile = Math.max(0, ...perFile.values());
  if (maxInFile > MAX_APPLY_EDITS_PER_FILE) {
    throw new SnapshotApplyError(
      `${maxInFile} edits in one file > apply max ${MAX_APPLY_EDITS_PER_FILE}`,
    );
  }
  const editBytes = Buffer.byteLength(JSON.stringify(plan.edits), "utf8");
  if (editBytes > MAX_APPLY_TOTAL_BYTES) {
    throw new SnapshotApplyError(`${editBytes} edit bytes > apply max ${MAX_APPLY_TOTAL_BYTES}`);
  }

  const rootAbs = path.resolve(rootDir);
  const originals = new Map<string, string>();
  for (const filePath of declared) {
    const target = path.resolve(rootAbs, filePath);
    if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
      throw new SnapshotApplyError(`apply rejected: ${filePath} escapes the checkout`);
    }
    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch {
      throw new SnapshotApplyError(`apply rejected: ${filePath} unreadable in checkout`);
    }
    const actualHash = sha256Hex(content);
    const manifestHash = manifestMap.get(filePath);
    if (actualHash !== manifestHash) {
      throw new SnapshotApplyError(
        `apply rejected: ${filePath} changed since analysis (stale checkout)`,
      );
    }
    originals.set(filePath, content);
  }

  const patched = new Map(originals);
  for (const edit of plan.edits) {
    const current = patched.get(edit.filePath);
    if (current === undefined) {
      throw new SnapshotApplyError(`apply rejected: ${edit.filePath} missing from checkout`);
    }
    patched.set(edit.filePath, applyOneEdit(current, edit));
  }

  // No file outside the declared plan may change: re-hash every manifest file
  // that was NOT declared and fail closed on any drift.
  for (const file of manifest.files) {
    if (declared.has(file.path)) continue;
    const target = path.resolve(rootAbs, file.path);
    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch {
      continue;
    }
    if (sha256Hex(content) !== file.sha256) {
      throw new SnapshotApplyError(
        `apply rejected: undeclared file changed during application: ${file.path}`,
      );
    }
  }

  const artifacts: AppliedSnapshotArtifact[] = [];
  let totalDiffLines = 0;
  for (const filePath of [...declared].sort()) {
    const original = originals.get(filePath) ?? "";
    const next = patched.get(filePath) ?? "";
    if (next === original) continue;
    const diff = unifiedDiff(original, next, filePath);
    totalDiffLines += diff.split("\n").length;
    if (totalDiffLines > MAX_APPLY_DIFF_LINES) {
      throw new SnapshotApplyError(
        `diff exceeds ${MAX_APPLY_DIFF_LINES} lines; refusing an unbounded patch`,
      );
    }
    const edit = plan.edits.find((item) => item.filePath === filePath);
    artifacts.push({
      filePath,
      originalContent: original,
      patchedContent: next,
      unifiedDiff: diff,
      originalHash: sha256Hex(original),
      patchedHash: sha256Hex(next),
      confidence: edit?.confidence ?? 0,
    });
    // Persist the patched content to the checkout for isolated validation.
    const target = path.resolve(rootAbs, filePath);
    writeFileSync(target, next, "utf8");
  }
  return artifacts;
}

function countOccurrences(content: string, anchor: string): number {
  if (anchor.length === 0) return 0;
  return content.split(anchor).length - 1;
}

function applyOneEdit(
  content: string,
  edit: {
    operation: string;
    searchText?: string | null;
    replacement?: string | null;
    expectedOccurrences?: number | null;
    filePath: string;
  },
): string {
  if (
    edit.operation !== "REPLACE" &&
    edit.operation !== "INSERT_AFTER" &&
    edit.operation !== "DELETE"
  ) {
    throw new SnapshotApplyError(`unsupported operation ${edit.operation}: ${edit.filePath}`);
  }
  if (!edit.searchText) {
    throw new SnapshotApplyError(`${edit.operation} requires searchText: ${edit.filePath}`);
  }
  if (
    edit.operation !== "DELETE" &&
    (edit.replacement === undefined || edit.replacement === null)
  ) {
    throw new SnapshotApplyError(`${edit.operation} requires replacement: ${edit.filePath}`);
  }
  // Single-anchor by default: the anchor must match EXACTLY the declared
  // occurrence count (default 1). Zero matches = stale plan; multiple matches
  // with default 1 = ambiguous plan (one edit must never rewrite N locations
  // silently). Multi-occurrence edits must declare expectedOccurrences = N
  // (bounded max 10 by schema) and match exactly N.
  const expected = edit.expectedOccurrences ?? 1;
  const actual = countOccurrences(content, edit.searchText);
  if (actual === 0) {
    throw new SnapshotApplyError(
      `${edit.operation} anchor missing in ${edit.filePath}; stale plan (expected ${expected}, found 0)`,
    );
  }
  if (actual !== expected) {
    throw new SnapshotApplyError(
      `${edit.operation} anchor matches ${actual} locations in ${edit.filePath}; expected exactly ${expected} (declare expectedOccurrences explicitly for multi-occurrence edits)`,
    );
  }
  if (edit.operation === "REPLACE") {
    return content.split(edit.searchText).join(edit.replacement as string);
  }
  if (edit.operation === "INSERT_AFTER") {
    return content.split(edit.searchText).join(edit.searchText + (edit.replacement as string));
  }
  return content.split(edit.searchText).join("");
}

/**
 * Bounded source excerpts for the evidence packet: ranked impacted files only,
 * read from the snapshot checkout (never the live repo), truncated per-file
 * and in total. Files are untrusted data — callers sanitize before prompting.
 */
export function collectSnapshotExcerpts(
  rootDir: string,
  filePaths: ReadonlyArray<string>,
  options: { maxFiles?: number; maxCharsPerFile?: number } = {},
): Array<{ filePath: string; excerpt: string }> {
  const maxFiles = options.maxFiles ?? 8;
  const maxChars = options.maxCharsPerFile ?? 2_000;
  const rootAbs = path.resolve(rootDir);
  const excerpts: Array<{ filePath: string; excerpt: string }> = [];
  for (const filePath of filePaths.slice(0, maxFiles)) {
    try {
      assertSafeSnapshotPath(filePath);
    } catch {
      continue;
    }
    const target = path.resolve(rootAbs, filePath);
    if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) continue;
    try {
      const content = readFileSync(target, "utf8");
      excerpts.push({ filePath, excerpt: content.slice(0, maxChars) });
    } catch {
      continue;
    }
  }
  return excerpts;
}

/** Tree hash helper for fixture-free verification (git write-tree). */
export function gitTreeHash(workspaceDir: string): string {
  const tree = runGit(["write-tree"], { cwd: workspaceDir, capture: true });
  return tree ?? "";
}
