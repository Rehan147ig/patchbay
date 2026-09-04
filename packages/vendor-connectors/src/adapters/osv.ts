import { createHash } from "node:crypto";
import { compareVersions, type ReleaseSource } from "@patchbay/domain";
import { fetchWithTrust } from "../safe-fetch";
import { OSV_TRUST_PROFILE } from "../trust";
import type {
  AdapterCursor,
  NormalizedRelease,
  WatchtowerAdapter,
  WatchtowerEvidence,
} from "../watchtower";

/**
 * OSV vulnerability-intel adapter (Step 3: universal CVE remediation).
 *
 * Unlike release-feed adapters, OSV answers "is package@version vulnerable,
 * and what fixes it?" — one instance per (ecosystem, package, installed
 * version), constructed at scan time for direct dependencies. Each poll
 * queries `POST /v1/query` behind the OSV trust profile (exact-host
 * api.osv.dev, path-pinned, capped, timed out) and emits one evidence per
 * newly observed vulnerability.
 *
 * Provenance model: OSV is the *discovery channel*; the fix release itself
 * comes from the package registry, so `source` stays NPM while `metadata`
 * records the OSV vuln id, severity, and fixed version. Fixed versions feed
 * the autonomous semver-bump track directly (fixed = toVersion).
 */

const OSV_API_URL = "https://api.osv.dev/v1/query";
const OSV_ECOSYSTEMS = { npm: "npm", pypi: "PyPI" } as const;
const SEEN_VULNS_LIMIT = 100;
const EVIDENCE_CAP = 10;

export interface OsvAdapterOptions {
  ecosystem: keyof typeof OSV_ECOSYSTEMS;
  packageName: string;
  installedVersion: string;
}

interface OsvEvent {
  introduced?: string;
  fixed?: string;
}

interface OsvRange {
  type?: string;
  events?: OsvEvent[];
}

interface OsvSeverity {
  type?: string;
  score?: string;
}

interface OsvVuln {
  id?: string;
  summary?: string;
  published?: string;
  severity?: OsvSeverity[];
  affected?: Array<{ ranges?: OsvRange[] }>;
}

interface OsvCursor {
  seenVulnIds: string[];
  lastChecked: string | null;
}

function normalizeCursor(cursor?: AdapterCursor): OsvCursor {
  const raw = (cursor ?? {}) as Record<string, unknown>;
  return {
    seenVulnIds: Array.isArray(raw.seenVulnIds)
      ? (raw.seenVulnIds.filter((v) => typeof v === "string") as string[])
      : [],
    lastChecked: typeof raw.lastChecked === "string" ? raw.lastChecked : null,
  };
}

/** Highest CVSS-style numeric score on the vuln, or null when unscored. */
export function osvMaxScore(vuln: OsvVuln): number | null {
  let best: number | null = null;
  for (const entry of vuln.severity ?? []) {
    const score = Number(entry?.score);
    if (Number.isFinite(score) && (best === null || score > best)) best = score;
  }
  return best;
}

/**
 * Minimum fixed version across all affected ranges (SEMVER events), or null
 * when the vuln carries no fixed version (still emitted as intel: known-vuln,
 * no fix yet — PLAN-only, never a bump).
 */
export function osvFixedVersion(vuln: OsvVuln): string | null {
  let best: string | null = null;
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (!event.fixed) continue;
        if (best === null || (compareVersions(event.fixed, best) ?? 0) < 0) {
          best = event.fixed;
        }
      }
    }
  }
  return best;
}

export function createOsvAdapter(options: OsvAdapterOptions): WatchtowerAdapter {
  const { ecosystem, packageName, installedVersion } = options;
  const osvEcosystem = OSV_ECOSYSTEMS[ecosystem];

  function evidenceFor(vuln: OsvVuln): WatchtowerEvidence {
    const vulnId = vuln.id ?? "unknown";
    const fixedVersion = osvFixedVersion(vuln);
    const rawPayload = JSON.stringify(vuln);
    const contentHash = createHash("sha256").update(rawPayload).digest("hex");
    return {
      externalId: `osv:${packageName}@${installedVersion}#${vulnId}`,
      vendorSlug: packageName,
      packageName,
      version: fixedVersion ?? installedVersion,
      previousVersion: installedVersion,
      source: "NPM" as ReleaseSource,
      canonicalUrl: `https://osv.dev/vulnerability/${vulnId}`,
      contentHash,
      rawPayload,
      publishedAt: vuln.published ? new Date(vuln.published) : new Date(),
      metadata: {
        discovery: "OSV",
        vulnId,
        summary: vuln.summary ?? null,
        severityScore: osvMaxScore(vuln),
        fixedVersion,
        hasFix: fixedVersion !== null,
      },
    };
  }

  return {
    slug: `osv:${packageName}`,
    source: "NPM" as ReleaseSource,

    supports(input: unknown): boolean {
      if (typeof input !== "object" || input === null) return false;
      const obj = input as Record<string, unknown>;
      return (
        obj.osv === true &&
        obj.packageName === packageName &&
        typeof obj.installedVersion === "string"
      );
    },

    normalize(input: unknown): NormalizedRelease {
      if (!this.supports(input)) {
        throw new Error(`Input not supported by OSV adapter for ${packageName}`);
      }
      const obj = input as Record<string, unknown>;
      const vuln = (obj.vuln ?? {}) as OsvVuln;
      const fixedVersion = (obj.fixedVersion as string | undefined) ?? osvFixedVersion(vuln);
      return {
        vendorSlug: packageName,
        packageName,
        version: fixedVersion ?? installedVersion,
        previousVersion: installedVersion,
        source: "NPM" as ReleaseSource,
        canonicalUrl: `https://osv.dev/vulnerability/${(obj.vulnId as string | undefined) ?? vuln.id ?? "unknown"}`,
        contentHash: obj.contentHash as string,
        publishedAt: obj.publishedAt ? new Date(obj.publishedAt as string) : new Date(),
        metadata: obj.metadata as Record<string, unknown> | undefined,
      };
    },

    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = normalizeCursor(cursor);

      const response = await fetchWithTrust(OSV_API_URL, OSV_TRUST_PROFILE, {
        headers: { "Content-Type": "application/json" },
        // OSV requires POST with a JSON body. The body is caller-constructed
        // from the adapter options (never external text); URL + profile
        // enforcement (domain, path, caps, timeout, CA) applies unchanged.
        method: "POST",
        body: JSON.stringify({
          package: { name: packageName, ecosystem: osvEcosystem },
          version: installedVersion,
        }),
      });
      const data = JSON.parse(response.text) as { vulns?: unknown };
      // Defensive: a compromised or buggy mirror may return non-array or
      // non-object shapes. Anything unexpected yields empty evidence — intel
      // is fail-open, actions stay fail-closed downstream.
      const vulns = Array.isArray(data?.vulns) ? (data.vulns as OsvVuln[]) : [];

      const seen = new Set(prev.seenVulnIds);
      const evidence: WatchtowerEvidence[] = [];
      for (const vuln of vulns) {
        if (typeof vuln !== "object" || vuln === null) continue;
        if (typeof vuln.id !== "string" || seen.has(vuln.id)) continue;
        seen.add(vuln.id);
        evidence.push(evidenceFor(vuln));
        if (evidence.length >= EVIDENCE_CAP) break;
      }

      return {
        evidence,
        cursor: {
          seenVulnIds: [...seen].slice(-SEEN_VULNS_LIMIT),
          lastChecked: new Date().toISOString(),
        },
      };
    },
  };
}
