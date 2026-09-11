import type { PatchPlan } from "@patchbay/domain";

/**
 * Snapshot-backed AI hash binding (connected-repo pipeline).
 *
 * Replaces the fixture-only `bindFixtureHashes()` path: every proposed edit
 * is bound to the immutable snapshot manifest hashes, and any missing,
 * unsafe, or stale target invalidates that edit. A zero-edit or partially
 * invalidated plan is NEVER a successful patch — callers record explicit
 * PLAN_ONLY or INVALIDATED outcomes with audit evidence explaining why.
 *
 * DB-free, FS-free, network-free: the manifest map is built by
 * `@patchbay/git-provider` (filesystem) or the worker snapshot service (DB)
 * and handed in here as a plain Map.
 */

export const SNAPSHOT_HASH_PLACEHOLDER =
  "0000000000000000000000000000000000000000000000000000000000000000";

const ALLOWED_OPERATIONS = new Set(["REPLACE", "INSERT_AFTER", "DELETE"]);

/** Hard caps for the deterministic evidence packet ( §4 ). */
export const MAX_EVIDENCE_FILES = 8;
export const MAX_EXCERPT_CHARS = 2_000;
export const MAX_TOTAL_CONTEXT_CHARS = 12_000;
/** Graph hops are bounded upstream (impact analyst); the packet records the bound. */
export const MAX_GRAPH_HOPS = 3;

export interface SnapshotInvalidation {
  filePath: string;
  reason: string;
}

export interface BoundSnapshotPlan {
  plan: PatchPlan;
  invalidated: SnapshotInvalidation[];
}

/**
 * Local posix-relative path guard (mirrors git-provider `assertSafeSnapshotPath`
 * without adding a package dependency). Absolute paths, traversal, empty
 * segments, backslashes, and non-normalized forms fail closed.
 */
export function isSafeSnapshotPath(filePath: string): boolean {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 512) return false;
  if (filePath.includes("\0") || filePath.includes("\\")) return false;
  if (filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath)) return false;
  const segments = filePath.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return false;
  }
  // Normalized form check: ./a, a//b, a/./b all fail.
  const normalized = segments.join("/");
  if (normalized !== filePath) return false;
  if (filePath.startsWith("./") || filePath.includes("/./") || filePath.includes("//"))
    return false;
  return true;
}

/**
 * Binds every proposed edit to the snapshot manifest:
 * - unsafe path -> invalidated (never bound, never applied);
 * - missing from manifest -> invalidated;
 * - non-placeholder stale source hash -> invalidated (not silently repaired);
 * - unsupported operation -> invalidated;
 * - placeholder (all zeros) or matching hash -> bound to the manifest hash.
 */
export function bindSnapshotHashes(
  plan: PatchPlan,
  fileHashes: ReadonlyMap<string, string>,
): BoundSnapshotPlan {
  const invalidated: SnapshotInvalidation[] = [];
  const edits: PatchPlan["edits"] = [];
  for (const edit of plan.edits) {
    if (!isSafeSnapshotPath(edit.filePath)) {
      invalidated.push({ filePath: edit.filePath, reason: "unsafe path rejected" });
      continue;
    }
    const manifestHash = fileHashes.get(edit.filePath);
    if (manifestHash === undefined) {
      invalidated.push({
        filePath: edit.filePath,
        reason: "file not found in repository snapshot",
      });
      continue;
    }
    if (!ALLOWED_OPERATIONS.has(edit.operation)) {
      invalidated.push({
        filePath: edit.filePath,
        reason: `unsupported operation ${edit.operation}`,
      });
      continue;
    }
    if (
      edit.expectedSourceHash !== SNAPSHOT_HASH_PLACEHOLDER &&
      edit.expectedSourceHash !== manifestHash
    ) {
      invalidated.push({
        filePath: edit.filePath,
        reason: "stale source hash: snapshot changed since analysis",
      });
      continue;
    }
    edits.push({ ...edit, expectedSourceHash: manifestHash });
  }
  return { plan: { ...plan, edits }, invalidated };
}

export type BoundPlanOutcome = "PATCH_PROPOSED" | "PLAN_ONLY" | "INVALIDATED";

/**
 * Never represents a zero-edit or partially invalidated plan as success.
 * - 0 edits -> PLAN_ONLY (nothing to apply, case stays plan-only);
 * - any invalidated -> INVALIDATED (fail closed even when some edits remain);
 * - otherwise PATCH_PROPOSED (still needs validation -> policy -> approval).
 */
export function classifyBoundPlan(
  boundEdits: number,
  invalidatedCount: number,
): { outcome: BoundPlanOutcome; reason: string } {
  if (boundEdits === 0) {
    return {
      outcome: "PLAN_ONLY",
      reason:
        invalidatedCount > 0
          ? `all ${invalidatedCount} proposed edit(s) invalidated against the snapshot; plan-only`
          : "planner proposed zero edits; plan-only",
    };
  }
  if (invalidatedCount > 0) {
    return {
      outcome: "INVALIDATED",
      reason: `${invalidatedCount} edit(s) invalidated against the snapshot; refusing a partial patch`,
    };
  }
  return { outcome: "PATCH_PROPOSED", reason: `${boundEdits} edit(s) bound to snapshot hashes` };
}

// ---------------------------------------------------------------------------
// Bounded deterministic evidence packet ( §4 ).
// The model receives ONLY this packet: normalized change, graph impact,
// manifest entries, rule-pack metadata, policy/validation summaries, ranked
// source excerpts from impacted files, and snapshot identity. No shell, no
// filesystem, no credentials, no branch access, no command selection, no
// network. Repository files, release notes, and vendor payloads are UNTRUSTED
// data: control chars stripped, instruction-like phrasing neutralized, and
// every field wrapped in data-only markers (same contract as ai-provider
// prompt-safety; Zod validation still gates the output).
// ---------------------------------------------------------------------------

export interface EvidenceExcerpt {
  filePath: string;
  /** Raw source excerpt (untrusted); sanitized + bounded by the builder. */
  excerpt: string;
}

export interface EvidencePacketInput {
  vendorSlug: string;
  packageName: string;
  fromVersion: string | null;
  toVersion: string;
  breaking: boolean;
  drafts: Array<{
    changeType: string;
    oldValue: string | null;
    newValue: string | null;
    description: string | null;
    breaking: boolean;
    affectedSymbols: string[];
    rule: string | null;
  }>;
  modules: Array<{ filePath: string; edgeKinds: string[]; evidenceCount: number }>;
  snapshot: { commitSha: string; treeHash: string; manifestHash: string };
  excerpts: EvidenceExcerpt[];
  rulePack?: {
    packVersion: string;
    vendorSlug: string;
    contractKind: string;
    validationProfile: string;
    riskTags: string[];
  } | null;
  policySummary?: { decision: string; requiresHumanReview: boolean } | null;
  validationSummary?: { commands: string[] } | null;
}

export interface EvidencePacket {
  vendorSlug: string;
  packageName: string;
  fromVersion: string | null;
  toVersion: string;
  breaking: boolean;
  drafts: EvidencePacketInput["drafts"];
  modules: EvidencePacketInput["modules"];
  snapshot: EvidencePacketInput["snapshot"];
  excerpts: Array<{ filePath: string; excerpt: string }>;
  rulePack: EvidencePacketInput["rulePack"] | null;
  policySummary: EvidencePacketInput["policySummary"] | null;
  validationSummary: EvidencePacketInput["validationSummary"] | null;
  caps: { maxFiles: number; maxExcerptChars: number; maxTotalChars: number; maxGraphHops: number };
  totalExcerptChars: number;
}

const CONTROL_CHARS = /[--]/g;

function sanitizeExcerptText(text: string): string {
  let cleaned = text.replace(CONTROL_CHARS, " ").trim();
  cleaned = cleaned
    .replace(
      /\b(?:ignore|disregard|forget|overwrite)\b[^.\n]{0,80}\b(?:instructions?|prompts?|rules?|system)\b/gi,
      "[instruction-like content neutralized]",
    )
    .replace(
      /\b(?:you are|from now on|act as)\b[^.\n]{0,80}\b(?:assistant|agent|system|admin)\b/gi,
      "[instruction-like content neutralized]",
    );
  cleaned = cleaned.split("<<<UNTRUSTED-DATA-START>>>").join("[marker-stripped]");
  cleaned = cleaned.split("<<<UNTRUSTED-DATA-END>>>").join("[marker-stripped]");
  return cleaned;
}

/**
 * Deterministic excerpt selection: rank impacted files by evidence density,
 * take the first MAX_EVIDENCE_FILES that have excerpts, bound each excerpt to
 * MAX_EXCERPT_CHARS and the total to MAX_TOTAL_CONTEXT_CHARS. Pure + stable.
 */
export function buildEvidencePacket(input: EvidencePacketInput): EvidencePacket {
  const byPath = new Map(input.excerpts.map((item) => [item.filePath, item.excerpt]));
  const ranked = [...input.modules].sort((a, b) => {
    if (b.evidenceCount !== a.evidenceCount) return b.evidenceCount - a.evidenceCount;
    return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
  });
  const excerpts: Array<{ filePath: string; excerpt: string }> = [];
  let total = 0;
  for (const module of ranked) {
    if (excerpts.length >= MAX_EVIDENCE_FILES) break;
    if (total >= MAX_TOTAL_CONTEXT_CHARS) break;
    const raw = byPath.get(module.filePath);
    if (raw === undefined) continue;
    const sanitized = sanitizeExcerptText(raw).slice(0, MAX_EXCERPT_CHARS);
    const remaining = MAX_TOTAL_CONTEXT_CHARS - total;
    const bounded = sanitized.slice(0, remaining);
    excerpts.push({
      filePath: module.filePath,
      excerpt: `<<<UNTRUSTED-DATA-START>>>\n${bounded}\n<<<UNTRUSTED-DATA-END>>>`,
    });
    total += bounded.length;
  }
  return {
    vendorSlug: input.vendorSlug,
    packageName: input.packageName,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    breaking: input.breaking,
    drafts: input.drafts.slice(0, 30),
    modules: input.modules.slice(0, 200),
    snapshot: input.snapshot,
    excerpts,
    rulePack: input.rulePack ?? null,
    policySummary: input.policySummary ?? null,
    validationSummary: input.validationSummary ?? null,
    caps: {
      maxFiles: MAX_EVIDENCE_FILES,
      maxExcerptChars: MAX_EXCERPT_CHARS,
      maxTotalChars: MAX_TOTAL_CONTEXT_CHARS,
      maxGraphHops: MAX_GRAPH_HOPS,
    },
    totalExcerptChars: total,
  };
}
