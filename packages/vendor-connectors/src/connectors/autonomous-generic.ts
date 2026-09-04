import { classifySemverBump, type SemverBumpKind } from "@patchbay/domain";
import type { NormalizedChangeDraft, PatchSuggestion, VendorConnector } from "../types";

/**
 * Autonomous generic connector (Phase 2: universal semver-bump track).
 *
 * Handles patch/minor version bumps for ANY direct dependency without a
 * hand-written rule pack — the industry-standard Renovate/Dependabot split:
 * semver-compatible bumps need no migration rules because trust comes from
 * sandbox validation + the customer's CI on the draft PR, not from fixtures.
 *
 * Manifest edits are applied by the remediation-engine semver-bump kit, never
 * by symbol suggestions: buildPatchSuggestions() is intentionally empty, so
 * generatePlan()'s symbol path is untouched. Major bumps normalize to a
 * breaking SDK_VERSION_UPGRADE (PLAN-only; the draft-PR gates refuse them).
 * Draft PRs only, never auto-merge — enforced at both PR vectors.
 *
 * Expected raw payload (emitted by lockfile-vs-registry diff):
 * ```json
 * {
 *   "source": "AUTONOMOUS",
 *   "ecosystem": "npm",
 *   "packageName": "lodash",
 *   "fromVersion": "4.17.20",
 *   "toVersion": "4.17.21",
 *   "updateType": "patch"
 * }
 * ```
 */

export const AUTONOMOUS_GENERIC_SLUG = "autonomous-generic";

/** Update kinds the autonomous track drafts PRs for. "major" is PLAN-only. */
export const AUTONOMOUS_DRAFT_ELIGIBLE: readonly SemverBumpKind[] = ["patch", "minor"];

export interface AutonomousBumpPayload {
  source: "AUTONOMOUS";
  ecosystem: "npm" | "pypi";
  packageName: string;
  fromVersion: string;
  toVersion: string;
  updateType: SemverBumpKind;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAutonomousBumpPayload(payload: unknown): payload is AutonomousBumpPayload {
  if (!isObject(payload)) return false;
  if (payload.source !== "AUTONOMOUS") return false;
  if (payload.ecosystem !== "npm" && payload.ecosystem !== "pypi") return false;
  if (typeof payload.packageName !== "string" || payload.packageName.trim() === "") return false;
  if (typeof payload.fromVersion !== "string" || typeof payload.toVersion !== "string") {
    return false;
  }
  return (
    payload.updateType === "patch" ||
    payload.updateType === "minor" ||
    payload.updateType === "major" ||
    payload.updateType === "unknown"
  );
}

/**
 * Draft-PR eligibility for the autonomous track. Phase 2 scope: npm
 * patch/minor only. Majors stay PLAN-only (migration rules may be needed);
 * pypi and unknown kinds are refused until their kits land. Pure and
 * unit-testable; enforced identically at both PR creation vectors.
 */
export function isAutonomousDraftEligible(payload: unknown): boolean {
  if (!isAutonomousBumpPayload(payload)) return false;
  if (payload.ecosystem !== "npm") return false;
  // The declared kind must agree with the classifier — a payload claiming
  // "patch" for a major move is rejected rather than trusted.
  const classified = classifySemverBump(payload.fromVersion, payload.toVersion);
  if (classified !== payload.updateType) return false;
  return (AUTONOMOUS_DRAFT_ELIGIBLE as readonly string[]).includes(classified);
}

export const autonomousGenericConnector: VendorConnector = {
  slug: AUTONOMOUS_GENERIC_SLUG,

  supports(rawPayload: unknown): boolean {
    return isAutonomousBumpPayload(rawPayload);
  },

  normalizeChange(input): NormalizedChangeDraft[] {
    const payload = input.rawPayload;
    if (!isAutonomousBumpPayload(payload)) return [];

    const breaking = payload.updateType === "major" || payload.updateType === "unknown";
    return [
      {
        changeType: "SDK_VERSION_UPGRADE",
        oldValue: payload.fromVersion,
        newValue: payload.toVersion,
        description:
          `Autonomous semver ${payload.updateType} bump for ${payload.packageName} ` +
          `(${payload.fromVersion} -> ${payload.toVersion}). ` +
          (breaking
            ? "Breaking-capable: PLAN-only, requires human-authored migration."
            : "Manifest-only edit, provable in the sandbox; draft PR only, never auto-merge."),
        breaking,
        affectedSymbols: [],
        evidence: {
          autonomous: true,
          updateType: payload.updateType,
          ecosystem: payload.ecosystem,
          package: payload.packageName,
        },
      },
    ];
  },

  buildPatchSuggestions(): PatchSuggestion[] {
    // Manifest bumps are applied by the semver-bump kit, never symbol edits.
    return [];
  },
};
