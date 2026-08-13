/**
 * Minimal deterministic semver helpers (no dependencies).
 *
 * Only the shapes Patchbay needs are supported: exact versions, caret / tilde
 * ranges, and loose comparison prefixes (>=, <=, >, <). Unknown or malformed
 * inputs return null — callers must decide how to treat it (never guess).
 *
 * AND-composed pairs (e.g. ">=3.0.0 <4.0.0") are supported: both parts must
 * hold. Ranges with more than two whitespace-separated parts are unsupported
 * and return false (never guess).
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/** -1 when a < b, 0 when equal, 1 when a > b. Null when either is opaque. */
export function compareVersions(a: string, b: string): number | null {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (parsedA[key] !== parsedB[key]) return parsedA[key] > parsedB[key] ? 1 : -1;
  }
  if (parsedA.prerelease === parsedB.prerelease) return 0;
  if (parsedA.prerelease === null && parsedB.prerelease === null) return 0;
  if (parsedA.prerelease === null) return 1;
  if (parsedB.prerelease === null) return -1;
  return parsedA.prerelease.localeCompare(parsedB.prerelease) < 0 ? -1 : 1;
}

/**
 * True when `version` satisfies a single npm-style range: exact ("3.3.0"),
 * caret ("^3.3.0"), tilde ("~3.3.0"), wildcard ("*"), prefix ranges
 * (">=4.0.0", "<=3.3.0", ">9.5.0", "<7.0.0"), "x.y.z - a.b.c" spans, and
 * AND-composed pairs (">=3.0.0 <4.0.0"). Anything else is not guessed:
 * it returns false.
 */
export function satisfiesRange(version: string, range: string | null | undefined): boolean {
  if (!range) return false;
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*") return true;

  // AND-composed pair: ">=3.0.0 <4.0.0". Exactly two whitespace-separated parts,
  // both must hold. More than two parts are unsupported and never guessed.
  const andParts = trimmed.split(/\s+/);
  if (andParts.length === 2) {
    return satisfiesRange(version, andParts[0]) && satisfiesRange(version, andParts[1]);
  }

  // Span: "x.y.z - a.b.c"
  const span = trimmed.split(/\s+-\s+/);
  if (span.length === 2) {
    const floor = span[0]?.trim() ?? "";
    const ceiling = span[1]?.trim() ?? "";
    if (!floor || !ceiling) return false;
    const parsedFloor = parseVersion(floor);
    const parsedCeiling = parseVersion(ceiling);
    const parsedVersion = parseVersion(version);
    if (!parsedFloor || !parsedCeiling || !parsedVersion) return false;
    if (
      parsedVersion.prerelease !== null &&
      parsedFloor.prerelease === null &&
      parsedCeiling.prerelease === null
    ) {
      return false;
    }
    const low = compareVersions(version, floor);
    const high = compareVersions(version, ceiling);
    if (low === null || high === null) return false;
    return low >= 0 && high <= 0;
  }

  if (trimmed.startsWith("^")) {
    const target = trimmed.slice(1).trim();
    const parsedTarget = parseVersion(target);
    const parsedVersion = parseVersion(version);
    if (!parsedTarget || !parsedVersion) return false;
    if (parsedVersion.major !== parsedTarget.major) return false;
    const cmp = compareVersions(version, target);
    if (cmp === null) return false;
    if (cmp === 0) return true;
    if (cmp < 0) return false;
    if (parsedVersion.prerelease !== null && parsedTarget.prerelease !== null) {
      return parsedVersion.prerelease === parsedTarget.prerelease;
    }
    if (parsedVersion.prerelease !== null) return false;
    if (parsedTarget.prerelease !== null) return false;
    return true;
  }

  if (trimmed.startsWith("~")) {
    const target = trimmed.slice(1).trim();
    const parsedTarget = parseVersion(target);
    const parsedVersion = parseVersion(version);
    if (!parsedTarget || !parsedVersion) return false;
    if (parsedVersion.prerelease !== null && parsedTarget.prerelease === null) return false;
    const nextCeiling = `${parsedTarget.major}.${parsedTarget.minor + 1}.0`;
    const low = compareVersions(version, target);
    const high = compareVersions(version, nextCeiling);
    if (low === null || high === null) return false;
    return low >= 0 && high < 0;
  }

  if (trimmed.startsWith(">=")) {
    const target = trimmed.slice(2).trim();
    const parsedTarget = parseVersion(target);
    const parsedVersion = parseVersion(version);
    if (!parsedTarget || !parsedVersion) return false;
    if (parsedVersion.prerelease !== null && parsedTarget.prerelease === null) return false;
    const cmp = compareVersions(version, target);
    if (cmp === null) return false;
    return cmp >= 0;
  }

  if (trimmed.startsWith("<=")) {
    const target = trimmed.slice(2).trim();
    const parsedTarget = parseVersion(target);
    const parsedVersion = parseVersion(version);
    if (!parsedTarget || !parsedVersion) return false;
    if (parsedVersion.prerelease !== null && parsedTarget.prerelease === null) return false;
    const cmp = compareVersions(version, target);
    if (cmp === null) return false;
    return cmp <= 0;
  }

  if (trimmed.startsWith(">")) {
    const target = trimmed.slice(1).trim();
    const parsedTarget = parseVersion(target);
    const parsedVersion = parseVersion(version);
    if (!parsedTarget || !parsedVersion) return false;
    if (parsedVersion.prerelease !== null && parsedTarget.prerelease === null) return false;
    const cmp = compareVersions(version, target);
    if (cmp === null) return false;
    return cmp > 0;
  }

  if (trimmed.startsWith("<")) {
    const target = trimmed.slice(1).trim();
    const parsedTarget = parseVersion(target);
    const parsedVersion = parseVersion(version);
    if (!parsedTarget || !parsedVersion) return false;
    if (parsedVersion.prerelease !== null && parsedTarget.prerelease === null) return false;
    const cmp = compareVersions(version, target);
    if (cmp === null) return false;
    return cmp < 0;
  }

  // Exact version (bare "3.3.0")
  return compareVersions(version, trimmed) === 0;
}
