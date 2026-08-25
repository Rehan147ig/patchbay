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
  /**
   * Optional path prefixes on the allowed hostnames (checked against
   * url.pathname). When set, a URL on an allowed domain with a non-matching
   * path is rejected — narrows domain-wide trust to the intended content root.
   */
  allowedPathPrefixes?: string[];
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
 * DETERMINISTIC) corroborates it with release evidence. Vendors publish their
 * canonical specs in their GitHub repos (raw.githubusercontent.com); vendor
 * API hosts do not serve the spec documents.
 */
export const OPENAPI_TRUST_PROFILE: TrustProfile = {
  adapterPrefix: "openapi:",
  sources: ["OPENAPI"],
  allowedDomains: ["raw.githubusercontent.com"],
  // Domain-wide raw access would let any future openapi:* adapter URL land on
  // any org/repo; pin to the intended content roots.
  allowedPathPrefixes: ["/stripe/openapi/"],
  allowRedirects: false,
  // Real vendor specs are large (stripe spec3.json ~8 MB decompressed); the
  // cap must fit them or every poll of that adapter fails.
  maxResponseBytes: 16 * 1024 * 1024,
  timeoutMs: 30_000,
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
 *
 * MISSING fields are allowed: adapters normalize their own cursors with safe
 * defaults (normalizeCursor), which is how genuinely legacy cursors from older
 * adapter versions self-heal instead of producing a permanent rejection loop.
 * Only PRESENT-but-wrong-typed fields are violations.
 */
export function validateAdapterCursor(adapterSlug: string, cursor: unknown): string[] {
  const violations: string[] = [];
  if (cursor === undefined || cursor === null) return violations;
  if (typeof cursor !== "object" || Array.isArray(cursor)) {
    violations.push("cursor must be a JSON object");
    return violations;
  }
  const entry = cursor as Record<string, unknown>;
  const isStringOrNull = (value: unknown): boolean => value === null || typeof value === "string";
  if (adapterSlug.startsWith("npm:")) {
    if ("etag" in entry && typeof entry.etag !== "string" && entry.etag !== null) {
      violations.push("npm cursor etag must be a string|null when present");
    }
    if ("latestVersion" in entry && !isStringOrNull(entry.latestVersion)) {
      violations.push("npm cursor latestVersion must be string|null when present");
    }
    if ("seenVersions" in entry && !Array.isArray(entry.seenVersions)) {
      violations.push("npm cursor seenVersions must be an array when present");
    }
  } else if (adapterSlug.startsWith("github-releases:")) {
    if ("etag" in entry && typeof entry.etag !== "string" && entry.etag !== null) {
      violations.push("github cursor etag must be a string|null when present");
    }
    if ("latestTag" in entry && !isStringOrNull(entry.latestTag)) {
      violations.push("github cursor latestTag must be string|null when present");
    }
    if ("latestPublishedAt" in entry && !isStringOrNull(entry.latestPublishedAt)) {
      violations.push("github cursor latestPublishedAt must be string|null when present");
    }
  } else if (adapterSlug.startsWith("openapi:")) {
    if ("etag" in entry && typeof entry.etag !== "string" && entry.etag !== null) {
      violations.push("openapi cursor etag must be a string|null when present");
    }
    if ("lastContentHash" in entry && !isStringOrNull(entry.lastContentHash)) {
      violations.push("openapi cursor lastContentHash must be string|null when present");
    }
    if ("lastSpec" in entry && entry.lastSpec !== null && typeof entry.lastSpec !== "object") {
      violations.push("openapi cursor lastSpec must be an object|null when present");
    }
  }
  return violations;
}
