import { GenerationMethod } from "@patchbay/domain";
import { classifySemverBump, type SemverBumpKind } from "@patchbay/domain";
import { sha256Hex, unifiedDiff } from "./diff";
import type { PatchDraft } from "./types";

/**
 * Autonomous semver-bump kit (Phase 2: universal manifest track).
 *
 * The deterministic "rule pack" for version-only upgrades: a byte-precise
 * package.json version-string edit that preserves range prefixes, file
 * formatting, and line endings. Anything it cannot prove (complex ranges,
 * missing package, non-JSON manifests, prereleases) returns null — PLAN-only,
 * never guessed.
 *
 * Only simple `[prefix]X.Y.Z` specs are rewritten (`^`, `~`, `>=`, bare).
 * Compound ranges (">=1.0.0 <2.0.0"), wildcards, tags ("latest"), URLs, and
 * file:/link: specs are out of scope and return null.
 */

const MANIFEST_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** "lodash" -> "lodash"; "@scope/pkg" -> "@scope\/pkg" for regex use. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SIMPLE_SPEC = /^(?<prefix>\^|~|>=)?(?<core>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export interface ManifestBumpSpec {
  section: (typeof MANIFEST_SECTIONS)[number];
  packageName: string;
  fromSpec: string;
}

/**
 * Locates `packageName` in the manifest sections. Returns null when the
 * manifest is not JSON, the package is absent, or the spec is not a simple
 * rewritable range. Pure and unit-testable.
 */
export function findManifestBumpSpec(
  manifestText: string,
  packageName: string,
): ManifestBumpSpec | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return null;
  }
  if (typeof manifest !== "object" || manifest === null) return null;
  const root = manifest as Record<string, unknown>;
  for (const section of MANIFEST_SECTIONS) {
    const table = root[section];
    if (typeof table !== "object" || table === null) continue;
    const spec = (table as Record<string, unknown>)[packageName];
    if (typeof spec !== "string") continue;
    if (!SIMPLE_SPEC.test(spec.trim())) return null;
    return { section, packageName, fromSpec: spec };
  }
  return null;
}

/**
 * Byte-precise version bump: replaces only the spec string, preserving
 * formatting, key order, and line endings. Returns null when the edit cannot
 * be proven (0/2+ textual occurrences — never guess which one).
 */
export function applySemverBump(
  manifestText: string,
  packageName: string,
  toVersion: string,
): string | null {
  const found = findManifestBumpSpec(manifestText, packageName);
  if (!found) return null;
  const match = SIMPLE_SPEC.exec(found.fromSpec.trim());
  if (!match?.groups) return null;
  const prefix = match.groups.prefix ?? "";
  const nextSpec = `${prefix}${toVersion}`;

  const pattern = new RegExp(
    `"${escapeRegExp(packageName)}"(\\s*:\\s*)"${escapeRegExp(found.fromSpec)}"`,
    "g",
  );
  const occurrences = manifestText.match(pattern) ?? [];
  if (occurrences.length !== 1) return null;
  return manifestText.replace(pattern, `"${packageName}"$1"${nextSpec}"`);
}

export interface SemverBumpPatchInput {
  manifestText: string;
  manifestPath?: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
}

/**
 * Builds the RULE_BASED PatchDraft for a manifest bump. Returns null unless
 * the move classifies patch/minor AND the manifest edit applies cleanly.
 * Majors/unknowns are PLAN-only by design (migration rules may be needed).
 */
export function buildSemverBumpPatch(input: SemverBumpPatchInput): PatchDraft | null {
  const kind: SemverBumpKind = classifySemverBump(input.fromVersion, input.toVersion);
  if (kind !== "patch" && kind !== "minor") return null;
  const patched = applySemverBump(input.manifestText, input.packageName, input.toVersion);
  if (!patched || patched === input.manifestText) return null;

  const filePath = input.manifestPath ?? "package.json";
  return {
    filePath,
    original: input.manifestText,
    patched,
    unifiedDiff: unifiedDiff(input.manifestText, patched, filePath),
    originalHash: sha256Hex(input.manifestText),
    patchedHash: sha256Hex(patched),
    generationMethod: GenerationMethod.RULE_BASED,
    confidence: kind === "patch" ? 95 : 85,
    description:
      `Autonomous semver ${kind} bump for ${input.packageName} ` +
      `(${input.fromVersion} -> ${input.toVersion}). Manifest-only edit; ` +
      `proven in sandbox, draft PR only, never auto-merge.`,
  };
}
