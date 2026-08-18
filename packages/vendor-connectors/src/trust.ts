import type { ReleaseSource } from "@patchbay/domain";

/**
 * Watchtower trust profiles (WP6).
 *
 * Every adapter poll is governed by a trust profile: allowed response domains,
 * redirect policy, maximum response size, timeout, and the authenticity
 * assigned to evidence the adapter produces. Profiles are code-defined
 * (deterministic-first); the detector-health view exposes them so operators
 * can see exactly what each detector trusts and rejects.
 */

export interface TrustProfile {
  /** Adapter slugs covered by this profile (prefix-matched, e.g. "npm:"). */
  adapterPrefix: string;
  /** Sources this profile is authoritative for. */
  sources: ReleaseSource[];
  /** Exact hostnames the adapter may talk to. Redirects off this list are rejected. */
  allowedDomains: string[];
  /** Whether 3xx responses are permitted; when false they are rejected. */
  allowRedirects: boolean;
  /** Maximum response body size in bytes. */
  maxResponseBytes: number;
  /** Overall request timeout in milliseconds. */
  timeoutMs: number;
  /** Whether the source requires a cryptographic signature. */
  requireSignature: boolean;
  /** Authenticity granted to evidence that passes the profile checks. */
  evidenceAuthenticity: "VERIFIED" | "SOURCE_TRUSTED" | "UNVERIFIED";
  /** Evidence confidence label surfaced in detector health. */
  evidenceConfidence: "HIGH" | "MEDIUM" | "LOW";
  /** Recommended poll cadence (milliseconds), surfaced in detector health. */
  cadenceMs: number;
}

/** npm registry: exact-host, no redirects, large packument cap, 15s timeout. */
export const NPM_TRUST_PROFILE: TrustProfile = {
  adapterPrefix: "npm:",
  sources: ["NPM"],
  allowedDomains: ["registry.npmjs.org"],
  allowRedirects: false,
  maxResponseBytes: 10 * 1024 * 1024,
  timeoutMs: 15_000,
  requireSignature: false,
  evidenceAuthenticity: "SOURCE_TRUSTED",
  evidenceConfidence: "HIGH",
  cadenceMs: 15 * 60 * 1000,
};

/** GitHub releases API: exact-host, no redirects, 2MB cap, 15s timeout. */
export const GITHUB_TRUST_PROFILE: TrustProfile = {
  adapterPrefix: "github-releases:",
  sources: ["GITHUB_RELEASE"],
  allowedDomains: ["api.github.com"],
  allowRedirects: false,
  maxResponseBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  requireSignature: false,
  evidenceAuthenticity: "SOURCE_TRUSTED",
  evidenceConfidence: "HIGH",
  cadenceMs: 30 * 60 * 1000,
};

/**
 * OpenAPI spec fetches: an OpenAPI diff is an OBSERVATION, never a trusted
 * release, until deterministic classification (ReleaseClassificationMethod
 * DETERMINISTIC) corroborates it with release evidence.
 */
export const OPENAPI_TRUST_PROFILE: TrustProfile = {
  adapterPrefix: "openapi:",
  sources: ["OPENAPI"],
  allowedDomains: ["api.stripe.com"],
  allowRedirects: false,
  maxResponseBytes: 5 * 1024 * 1024,
  timeoutMs: 20_000,
  requireSignature: false,
  evidenceAuthenticity: "UNVERIFIED",
  evidenceConfidence: "LOW",
  cadenceMs: 15 * 60 * 1000,
};

const PROFILES: TrustProfile[] = [NPM_TRUST_PROFILE, GITHUB_TRUST_PROFILE, OPENAPI_TRUST_PROFILE];

/** Default for unknown adapters: fail closed (no domains, no redirects). */
const DEFAULT_PROFILE: TrustProfile = {
  adapterPrefix: "",
  sources: [],
  allowedDomains: [],
  allowRedirects: false,
  maxResponseBytes: 1 * 1024 * 1024,
  timeoutMs: 10_000,
  requireSignature: true,
  evidenceAuthenticity: "UNVERIFIED",
  evidenceConfidence: "LOW",
  cadenceMs: 15 * 60 * 1000,
};

export function trustProfileFor(adapterSlug: string): TrustProfile {
  return (
    PROFILES.find((profile) => adapterSlug.startsWith(profile.adapterPrefix)) ?? DEFAULT_PROFILE
  );
}

export function trustProfiles(): TrustProfile[] {
  return PROFILES;
}

/**
 * Authenticity a detector run should assign to observed evidence, derived from
 * the trust profile of the producing adapter.
 */
export function authenticityForSource(source: ReleaseSource): TrustProfile["evidenceAuthenticity"] {
  const profile = PROFILES.find((p) => p.sources.includes(source));
  return profile?.evidenceAuthenticity ?? DEFAULT_PROFILE.evidenceAuthenticity;
}

/**
 * Cursor shape validation per adapter. The persisted DetectionRun.cursor is
 * replayed into the adapter's next poll, so a malformed cursor (bad JSON from
 * a previous run, DB corruption, or tampering) must fail the run and be
 * audited instead of crashing the worker or polluting adapter state.
 */
export function validateAdapterCursor(adapterSlug: string, cursor: unknown): string[] {
  const violations: string[] = [];
  if (cursor === undefined || cursor === null) return violations;
  if (typeof cursor !== "object" || Array.isArray(cursor)) {
    violations.push("cursor must be a JSON object");
    return violations;
  }
  const entry = cursor as Record<string, unknown>;
  if (adapterSlug.startsWith("npm:")) {
    if (!("etag" in entry) || typeof entry.etag !== "string") {
      violations.push("npm cursor requires string etag");
    }
    if (
      !("latestVersion" in entry) ||
      (entry.latestVersion !== null && typeof entry.latestVersion !== "string")
    ) {
      violations.push("npm cursor requires latestVersion (string|null)");
    }
    if (!("seenVersions" in entry) || !Array.isArray(entry.seenVersions)) {
      violations.push("npm cursor requires seenVersions (string[])");
    }
  } else if (adapterSlug.startsWith("github-releases:")) {
    if (!("etag" in entry) || typeof entry.etag !== "string") {
      violations.push("github cursor requires string etag");
    }
    if (
      !("latestTag" in entry) ||
      (entry.latestTag !== null && typeof entry.latestTag !== "string")
    ) {
      violations.push("github cursor requires latestTag (string|null)");
    }
  } else if (adapterSlug.startsWith("openapi:")) {
    if (!("etag" in entry) || typeof entry.etag !== "string") {
      violations.push("openapi cursor requires string etag");
    }
    if (
      !("lastContentHash" in entry) ||
      (entry.lastContentHash !== null && typeof entry.lastContentHash !== "string")
    ) {
      violations.push("openapi cursor requires lastContentHash (string|null)");
    }
  }
  return violations;
}
