import { createHash } from "node:crypto";
import type { ReleaseSource } from "@patchbay/domain";
import type {
  AdapterCursor,
  NormalizedRelease,
  WatchtowerAdapter,
  WatchtowerEvidence,
} from "../watchtower";
import { fetchWithTrust } from "../safe-fetch";
import { resolveNpmTrustProfile } from "../trust";

const VENDOR_PACKAGES: Record<string, string> = {
  stripe: "stripe",
  openai: "openai",
  twilio: "twilio",
  auth0: "auth0",
};

const NPM_ACCEPT = "application/vnd.npm.install-v1+json";
const PUBLIC_NPM_REGISTRY_URL = "https://registry.npmjs.org";

/**
 * Enterprise npm mirror base URL (JFrog Artifactory, Sonatype Nexus,
 * CodeArtifact) from NPM_REGISTRY_URL, defaulting to the public registry.
 * Trailing slashes are stripped so path joins stay well-formed.
 */
export function getNpmRegistryUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NPM_REGISTRY_URL?.trim();
  if (!raw) return PUBLIC_NPM_REGISTRY_URL;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/**
 * Registry authorization headers. NPM_REGISTRY_TOKEN (Bearer) wins when both
 * are set; NPM_REGISTRY_AUTH carries a pre-encoded Basic value. Values are
 * never logged — callers must treat headers as secret material.
 */
export function npmRegistryAuthHeaders(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const token = env.NPM_REGISTRY_TOKEN?.trim();
  if (token) return { Authorization: `Bearer ${token}` };
  const basic = env.NPM_REGISTRY_AUTH?.trim();
  if (basic) return { Authorization: `Basic ${basic}` };
  return {};
}

export interface NpmLatestInfo {
  version: string;
  publishedAt: Date | null;
}

/**
 * Latest-version lookup for ANY npm package (not just catalog vendors).
 * Powers the autonomous track's lockfile-vs-registry diff. Throws on
 * transport/trust failures (404 included) — callers skip the dependency
 * rather than guessing. Honors mirror URL + auth + custom CA like the
 * adapter polls.
 */
export async function fetchNpmLatestVersion(packageName: string): Promise<NpmLatestInfo | null> {
  const url = `${getNpmRegistryUrl()}/${encodeURIComponent(packageName)}`;
  const response = await fetchWithTrust(url, resolveNpmTrustProfile(), {
    headers: { Accept: NPM_ACCEPT, ...npmRegistryAuthHeaders() },
  });
  const data = JSON.parse(response.text) as {
    "dist-tags"?: { latest?: string };
    time?: Record<string, string>;
  };
  const latest = data["dist-tags"]?.latest ?? null;
  if (!latest) return null;
  const published = data.time?.[latest];
  return { version: latest, publishedAt: published ? new Date(published) : null };
}

/**
 * npm registry adapter - polls the registry packument for a vendor package.
 * Produces evidence with source NPM. Polls are conditional: the ETag from the
 * previous poll is replayed as If-None-Match so an unchanged packument costs
 * one 304. Every version published since the persisted cursor is emitted with
 * its chronologically previous version attached.
 */
function npmPackageName(slug: string): string {
  const name = VENDOR_PACKAGES[slug];
  if (!name) throw new Error(`No npm package mapping for vendor: ${slug}`);
  return name;
}

export function createNpmAdapter(vendorSlug: string): WatchtowerAdapter {
  const packageName = npmPackageName(vendorSlug);

  const packageUrl = (version: string): string =>
    `https://www.npmjs.com/package/${packageName}/v/${version}`;

  interface NpmCursor extends AdapterCursor {
    etag: string | null;
    latestVersion: string | null;
    /** Versions already observed, newest first, for changelog diffing. */
    seenVersions: string[];
  }

  /** Newest versions retained in the persisted cursor (bounds cursor growth). */
  const SEEN_VERSIONS_LIMIT = 50;

  /**
   * Cursors persist as opaque JSON and outlive adapter code changes: a cursor
   * written before a field existed must never crash a poll. Normalize every
   * field defensively instead of trusting the stored shape.
   */
  function normalizeCursor(cursor?: AdapterCursor): NpmCursor {
    const c = (cursor ?? {}) as Partial<NpmCursor>;
    return {
      etag: typeof c.etag === "string" ? c.etag : null,
      latestVersion: typeof c.latestVersion === "string" ? c.latestVersion : null,
      seenVersions: Array.isArray(c.seenVersions)
        ? c.seenVersions.filter((v): v is string => typeof v === "string")
        : [],
    };
  }

  function evidenceFor(
    version: string,
    time: string | undefined,
    manifest: unknown,
    previousVersion?: string,
  ): WatchtowerEvidence {
    const rawPayload = JSON.stringify({
      package: packageName,
      version,
      publishedAt: time,
      manifest,
    });
    const contentHash = createHash("sha256").update(rawPayload).digest("hex");
    return {
      externalId: `npm:${packageName}@${version}`,
      vendorSlug,
      packageName,
      version,
      previousVersion,
      source: "NPM" as ReleaseSource,
      canonicalUrl: packageUrl(version),
      contentHash,
      rawPayload,
      publishedAt: new Date(time ?? Date.now()),
      metadata: { publishedAt: time },
    };
  }

  return {
    slug: `npm:${vendorSlug}`,
    source: "NPM" as ReleaseSource,

    supports(input: unknown): boolean {
      if (typeof input !== "object" || input === null) return false;
      const obj = input as Record<string, unknown>;
      return obj.vendorSlug === vendorSlug && obj.packageName === packageName;
    },

    normalize(input: unknown): NormalizedRelease {
      if (!this.supports(input)) {
        throw new Error(`Input not supported by npm adapter for ${vendorSlug}`);
      }
      const obj = input as Record<string, unknown>;
      return {
        vendorSlug,
        packageName,
        version: obj.version as string,
        previousVersion: obj.previousVersion as string | undefined,
        source: "NPM" as ReleaseSource,
        canonicalUrl: packageUrl(obj.version as string),
        contentHash: obj.contentHash as string,
        publishedAt: obj.publishedAt ? new Date(obj.publishedAt as string) : new Date(),
        metadata: obj.metadata as Record<string, unknown> | undefined,
      };
    },

    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = normalizeCursor(cursor);
      const headers: Record<string, string> = {
        Accept: NPM_ACCEPT,
        ...npmRegistryAuthHeaders(),
      };
      if (prev.etag) headers["If-None-Match"] = prev.etag;

      // Resolved per poll so registry/auth rotation needs no restart.
      const packumentUrl = `${getNpmRegistryUrl()}/${packageName}`;
      const response = await fetchWithTrust(packumentUrl, resolveNpmTrustProfile(), { headers });
      if (response.status === 304) {
        return { evidence: [], cursor: prev };
      }

      const etag = response.headers.get("etag");
      const data = JSON.parse(response.text) as {
        "dist-tags"?: Record<string, string>;
        versions?: Record<string, unknown>;
        time?: Record<string, string>;
      };

      const timeMap = data.time ?? {};
      // Newest first, only entries that correspond to an actual published version.
      const publishedVersions = Object.keys(timeMap)
        .filter((v) => v !== "created" && v !== "modified" && data.versions?.[v] !== undefined)
        .sort((a, b) => (timeMap[b] ?? "").localeCompare(timeMap[a] ?? ""));

      const newest = data["dist-tags"]?.latest ?? publishedVersions[0] ?? null;

      // Emit every version newer than the cursor, capped for safety.
      const known = new Set(prev.seenVersions);
      const evidence: WatchtowerEvidence[] = [];
      for (let i = publishedVersions.length - 1; i >= 0; i--) {
        const version = publishedVersions[i]!;
        if (known.has(version)) continue;
        const previousVersion = publishedVersions[i + 1];
        evidence.push(
          evidenceFor(version, timeMap[version], data.versions?.[version], previousVersion),
        );
      }
      // Cap at what an MVP poll should ever need; keep oldest-first (newest last).
      const capped = evidence.slice(0, 10);

      const seenVersions = [...new Set([...prev.seenVersions, ...publishedVersions])].slice(
        -SEEN_VERSIONS_LIMIT,
      );
      const next: NpmCursor = {
        etag: etag ?? prev.etag,
        latestVersion: newest,
        seenVersions,
      };
      return { evidence: capped, cursor: next };
    },
  };
}

/**
 * Create adapters for all known vendors.
 */
export function createAllNpmAdapters(): WatchtowerAdapter[] {
  return Object.keys(VENDOR_PACKAGES).map(createNpmAdapter);
}
