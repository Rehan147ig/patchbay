import { createHash } from "node:crypto";
import type { ReleaseSource } from "@patchbay/domain";
import type {
  AdapterCursor,
  NormalizedRelease,
  WatchtowerAdapter,
  WatchtowerEvidence,
} from "../watchtower";

const VENDOR_PACKAGES: Record<string, string> = {
  stripe: "stripe",
  openai: "openai",
  twilio: "twilio",
  auth0: "auth0",
};

const NPM_ACCEPT = "application/vnd.npm.install-v1+json";

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

  const packumentUrl = `https://registry.npmjs.org/${packageName}`;
  const packageUrl = (version: string): string =>
    `https://www.npmjs.com/package/${packageName}/v/${version}`;

  interface NpmCursor extends AdapterCursor {
    etag: string | null;
    latestVersion: string | null;
    /** Versions already observed, newest first, for changelog diffing. */
    seenVersions: string[];
  }

  function evidenceFor(
    version: string,
    time: string | undefined,
    previousVersion?: string,
  ): WatchtowerEvidence {
    const raw = JSON.stringify({ package: packageName, version, publishedAt: time });
    const contentHash = createHash("sha256").update(raw).digest("hex");
    return {
      externalId: `npm:${packageName}@${version}`,
      vendorSlug,
      packageName,
      version,
      previousVersion,
      source: "NPM" as ReleaseSource,
      canonicalUrl: packageUrl(version),
      contentHash,
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
      const prev = (cursor ?? { etag: null, latestVersion: null, seenVersions: [] }) as NpmCursor;
      const headers: Record<string, string> = { Accept: NPM_ACCEPT };
      if (prev.etag) headers["If-None-Match"] = prev.etag;

      const response = await fetch(packumentUrl, { headers });
      if (response.status === 304) {
        return { evidence: [], cursor: prev };
      }
      if (!response.ok) {
        throw new Error(`npm registry fetch failed: ${response.status}`);
      }

      const etag = response.headers.get("etag");
      const data = (await response.json()) as {
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
        evidence.push(evidenceFor(version, timeMap[version], previousVersion));
      }
      // Cap at what an MVP poll should ever need; keep oldest-first (newest last).
      const capped = evidence.slice(0, 10);

      const seenVersions = [...new Set([...prev.seenVersions, ...publishedVersions])];
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
