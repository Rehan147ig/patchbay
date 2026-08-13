/**
 * Deterministic release-to-repository dependency matching.
 *
 * Pure and DB-free so it can be replayed in CI against the historical
 * precision/recall corpus (match-corpus.ts) and reused by the match-release
 * worker. Semantics:
 *  - exact: the repository's resolved version equals the released version;
 *  - range: otherwise a match when the declared range admits the released
 *    version (see satisfiesRange — stable ranges never admit prereleases).
 * Keeps exact matches even when the range would not admit the exact version,
 * because an exact pin is stronger evidence than a declared range.
 */
import { satisfiesRange } from "./semver";

export interface DependencyFacts {
  /** Declared range from the manifest, e.g. "^3.3.0" (may be null). */
  declaredRange: string | null;
  /** Lockfile-resolved version the repository actually runs. */
  resolvedVersion: string;
}

export type ReleaseMatchOutcome =
  { matched: false } | { matched: true; exact: boolean; reason: string };

export function evaluateReleaseMatch(
  version: string,
  dependency: DependencyFacts,
  packageName = "package",
): ReleaseMatchOutcome {
  const exact = version === dependency.resolvedVersion;
  if (exact) {
    return {
      matched: true,
      exact: true,
      reason: `repository resolved ${packageName} to ${dependency.resolvedVersion} (the released version)`,
    };
  }
  const inRange = satisfiesRange(version, dependency.declaredRange);
  if (inRange) {
    return {
      matched: true,
      exact: false,
      reason: `declared range ${dependency.declaredRange} admits ${version}`,
    };
  }
  return { matched: false };
}
