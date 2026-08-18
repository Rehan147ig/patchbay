/**
 * Incremental re-extraction invalidation (WP5).
 *
 * Given the set of files that changed since the last READY graph snapshot and
 * the reverse dependency index of that snapshot, this module computes the set
 * of files that must be re-extracted so the resulting graph equals a clean
 * full extraction:
 *
 *  1. every changed file,
 *  2. every reliable reverse IMPORTS dependent (files that import a changed
 *     file may be affected by its changed exports),
 *  3. every reliable reverse CALLS caller (the callee's signature may have
 *     changed; only EXTRACTED/RESOLVED edges are reliable enough),
 *  4. every known dependent of changed codegen inputs / API specs,
 *  5. ALL scanned files when a manifest, lockfile, workspace configuration, or
 *     API spec changed, because resolution may change for any module.
 *
 * The result is a superset (conservative by design): the comparator corpus
 * asserts that re-extracting this set and merging with the unchanged facts
 * equals a clean full extraction for meaningful nodes and edges.
 */

export interface InvalidationInput {
  /** Relative paths that changed since the last snapshot. */
  changedFiles: string[];
  /** Reverse IMPORTS index: imported relative path -> importer relative paths. */
  reverseImports: Map<string, string[]>;
  /** Reverse CALLS index (reliable provenance only): callee -> callers. */
  reverseCalls: Map<string, string[]>;
  /** Every scanned source relative path (used for manifest-wide invalidation). */
  allFiles: string[];
  /** Codegen inputs / API specs: input relative path -> generated relative paths. */
  generatedBy?: Map<string, string[]>;
}

export interface InvalidationResult {
  /** Sorted set of files to re-extract (changed + invalidated). */
  reextract: string[];
  /** The originally changed files (sorted). */
  changed: string[];
  /** Dependents added by invalidation, not in the changed set (sorted). */
  invalidated: string[];
  /** Manifest-like changed files that triggered whole-repository invalidation. */
  invalidatingManifests: string[];
}

/** Files whose change can alter resolution for any module. */
const MANIFEST_PATTERNS = [
  /(^|\/)package\.json$/,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|npm-shrinkwrap\.json)$/,
  /(^|\/)tsconfig.*\.json$/,
  /(^|\/).*\.config\.(ts|js|mjs|cjs)$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.yarnrc(\.ya?ml)?$/,
  /(^|\/)\.env(\.\w+)?$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)turbo\.json$/,
];

/** API specs / codegen inputs whose change invalidates generated dependents. */
const SPEC_PATTERNS = [
  /(^|\/)(openapi|swagger|api)[\w-]*\.(json|ya?ml)$/,
  /(^|\/)\.?graphql(\.ya?ml|\.json)?$/,
];

function matches(patterns: RegExp[], filePath: string): boolean {
  return patterns.some((pattern) => pattern.test(filePath));
}

/**
 * Computes the conservative re-extraction set. Pure and deterministic: same
 * input always yields the same output, which the corpus comparator relies on.
 */
export function computeReextractionSet(input: InvalidationInput): InvalidationResult {
  const changed = [...input.changedFiles].sort();
  const invalidatingManifests = changed.filter(
    (file) => matches(MANIFEST_PATTERNS, file) || matches(SPEC_PATTERNS, file),
  );

  const reextract = new Set<string>(changed);

  // A manifest, lockfile, workspace config, or API spec can change resolution
  // for any module: invalidate every scanned file (conservative, correct).
  if (invalidatingManifests.length > 0) {
    for (const file of input.allFiles) reextract.add(file);
    for (const file of reextract) {
      // Whole-repository invalidation: also pull dependents of every file
      // (generated outputs of changed specs, and anything they feed).
      for (const dependent of dependentsOf(file, input)) reextract.add(dependent);
    }
    const invalidated = [...reextract].filter((file) => !changed.includes(file)).sort();
    return { reextract: [...reextract].sort(), changed, invalidated, invalidatingManifests };
  }

  // Breadth-first invalidation over reverse IMPORTS + reverse CALLS so that a
  // chain a -> b -> c re-extracts c, b, and a when c changes.
  const queue = [...reextract];
  const seen = new Set<string>(queue);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependentsOf(current, input)) {
      if (!seen.has(dependent)) {
        seen.add(dependent);
        queue.push(dependent);
      }
    }
  }

  const invalidated = [...seen].filter((file) => !changed.includes(file)).sort();
  return { reextract: [...seen].sort(), changed, invalidated, invalidatingManifests };
}

function dependentsOf(file: string, input: InvalidationInput): string[] {
  const dependents = new Set<string>();
  for (const importer of input.reverseImports.get(file) ?? []) dependents.add(importer);
  for (const caller of input.reverseCalls.get(file) ?? []) dependents.add(caller);
  for (const generated of input.generatedBy?.get(file) ?? []) dependents.add(generated);
  return [...dependents];
}

/**
 * Builds the reverse dependency index from a prior graph extraction.
 * Only EXTRACTED / RESOLVED edges are considered reliable: INFERRED or
 * AMBIGUOUS provenance alone can never trigger re-extraction decisions that
 * authorize changes.
 */
export function inverseIndex(extraction: {
  nodeFacts: Array<{ key: string; filePath: string | null }>;
  edgeFacts: Array<{
    kind: string;
    fromKey: string;
    toKey: string;
    provenance: string;
  }>;
}): Pick<InvalidationInput, "reverseImports" | "reverseCalls"> {
  const fileOf = new Map<string, string | null>();
  for (const node of extraction.nodeFacts) fileOf.set(node.key, node.filePath);

  const reverseImports = new Map<string, string[]>();
  const reverseCalls = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string): void => {
    if (!value) return;
    const list = map.get(key);
    if (list) {
      if (!list.includes(value)) list.push(value);
    } else {
      map.set(key, [value]);
    }
  };

  for (const edge of extraction.edgeFacts) {
    const targetFile = fileOf.get(edge.toKey);
    if (!targetFile) continue;
    if (edge.kind === "IMPORTS") {
      const importer = fileOf.get(edge.fromKey);
      if (importer) add(reverseImports, targetFile, importer);
    } else if (
      edge.kind === "CALLS" &&
      (edge.provenance === "EXTRACTED" || edge.provenance === "RESOLVED")
    ) {
      const caller = fileOf.get(edge.fromKey);
      if (caller) add(reverseCalls, targetFile, caller);
    }
  }

  return { reverseImports, reverseCalls };
}
