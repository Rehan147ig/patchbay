import { createHash } from "node:crypto";
import type { ReleaseSource } from "@patchbay/domain";
import type {
  AdapterCursor,
  NormalizedRelease,
  WatchtowerAdapter,
  WatchtowerEvidence,
} from "../watchtower";

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string | null;
  html_url: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
}

const VENDOR_REPOS: Record<string, { owner: string; repo: string }> = {
  stripe: { owner: "stripe", repo: "stripe-node" },
  openai: { owner: "openai", repo: "openai-node" },
  twilio: { owner: "twilio", repo: "twilio-node" },
  auth0: { owner: "auth0", repo: "auth0-nodejs" },
};

const VENDOR_PACKAGES: Record<string, string> = {
  stripe: "stripe",
  openai: "openai",
  twilio: "twilio",
  auth0: "auth0",
};

interface GitHubCursor extends AdapterCursor {
  /** ETag of the last releases response, replayed for conditional polls. */
  etag: string | null;
  /** Newest tag already observed. */
  latestTag: string | null;
  /** Newest published date already observed (ISO). */
  latestPublishedAt: string | null;
}

function stripV(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function evidenceFor(
  vendorSlug: string,
  repo: { owner: string; repo: string },
  release: GitHubRelease,
  previousTag?: string,
): WatchtowerEvidence {
  const tag = release.tag_name;
  const version = stripV(tag);
  const raw = JSON.stringify({
    tag,
    name: release.name,
    body: release.body,
    published_at: release.published_at,
    previous_tag: previousTag ?? null,
  });
  const contentHash = createHash("sha256").update(raw).digest("hex");
  return {
    externalId: `github:${repo.owner}/${repo.repo}@${tag}`,
    vendorSlug,
    packageName: VENDOR_PACKAGES[vendorSlug] ?? vendorSlug,
    version,
    previousVersion: previousTag !== undefined ? stripV(previousTag) : undefined,
    source: "GITHUB_RELEASE" as ReleaseSource,
    canonicalUrl: release.html_url,
    contentHash,
    publishedAt: new Date(release.published_at),
    metadata: { tag, name: release.name, body: release.body },
  };
}

/**
 * GitHub releases adapter - polls the releases API for vendor repositories,
 * conditionally via ETag. Produces evidence with source GITHUB_RELEASE.
 */
export function createGitHubReleasesAdapter(vendorSlug: string): WatchtowerAdapter {
  const repo = VENDOR_REPOS[vendorSlug];
  if (!repo) {
    throw new Error(`No GitHub repo mapping for vendor: ${vendorSlug}`);
  }

  return {
    slug: `github-releases:${vendorSlug}`,
    source: "GITHUB_RELEASE" as ReleaseSource,

    supports(input: unknown): boolean {
      if (typeof input !== "object" || input === null) return false;
      const obj = input as Record<string, unknown>;
      return obj.vendorSlug === vendorSlug && obj.tag_name !== undefined;
    },

    normalize(input: unknown): NormalizedRelease {
      if (!this.supports(input)) {
        throw new Error(`Input not supported by GitHub releases adapter for ${vendorSlug}`);
      }
      const obj = input as Record<string, unknown>;
      const tag = obj.tag_name as string;
      return {
        vendorSlug,
        packageName: VENDOR_PACKAGES[vendorSlug] ?? vendorSlug,
        version: stripV(tag),
        source: "GITHUB_RELEASE" as ReleaseSource,
        canonicalUrl: obj.html_url as string,
        contentHash: obj.contentHash as string,
        publishedAt: new Date(obj.published_at as string),
        metadata: { tag, name: obj.name, body: obj.body },
      };
    },

    async fetch(
      cursor?: AdapterCursor,
    ): Promise<{ evidence: WatchtowerEvidence[]; cursor: AdapterCursor }> {
      const prev = (cursor ?? {
        etag: null,
        latestTag: null,
        latestPublishedAt: null,
      }) as GitHubCursor;
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      }
      if (prev.etag) headers["If-None-Match"] = prev.etag;

      const response = await fetch(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases?per_page=10`,
        { headers },
      );
      if (response.status === 304) {
        return { evidence: [], cursor: prev };
      }
      if (!response.ok) {
        throw new Error(`GitHub releases fetch failed: ${response.status}`);
      }

      const etag = response.headers.get("etag");
      const releases = (await response.json()) as GitHubRelease[];
      const candidates = releases.filter((r) => !r.draft && !r.prerelease);
      const seenLatest = prev.latestPublishedAt ? new Date(prev.latestPublishedAt).getTime() : 0;

      const knownTags = new Set<string>(prev.latestTag ? [prev.latestTag] : []);
      const evidence: WatchtowerEvidence[] = [];
      // Walk oldest-first so each evidence gets its chronological predecessor
      // (candidates[i+1] was published just before candidates[i]).
      for (let i = candidates.length - 1; i >= 0; i--) {
        const release = candidates[i]!;
        if (knownTags.has(release.tag_name)) continue;
        if (prev.latestPublishedAt && new Date(release.published_at).getTime() <= seenLatest)
          continue;
        evidence.push(evidenceFor(vendorSlug, repo, release, candidates[i + 1]?.tag_name));
      }

      const newest = candidates[0];
      const next: GitHubCursor = {
        etag: etag ?? prev.etag,
        latestTag: newest?.tag_name ?? prev.latestTag,
        latestPublishedAt: newest?.published_at ?? prev.latestPublishedAt,
      };
      return { evidence, cursor: next };
    },
  };
}

export function createAllGitHubReleasesAdapters(): WatchtowerAdapter[] {
  return Object.keys(VENDOR_REPOS).map(createGitHubReleasesAdapter);
}
