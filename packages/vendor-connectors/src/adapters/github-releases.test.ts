import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubReleasesAdapter } from "./github-releases";

const RELEASES = [
  {
    tag_name: "v4.8.1",
    name: "4.8.1",
    body: "fixes",
    html_url: "https://github.com/openai/openai-node/releases/tag/v4.8.1",
    published_at: "2026-08-01T00:00:00Z",
    prerelease: false,
    draft: false,
  },
  {
    tag_name: "v4.0.0",
    name: "4.0.0",
    body: "breaking",
    html_url: "https://github.com/openai/openai-node/releases/tag/v4.0.0",
    published_at: "2025-06-01T00:00:00Z",
    prerelease: false,
    draft: false,
  },
  {
    tag_name: "v3.3.0",
    name: "3.3.0",
    body: null,
    html_url: "https://github.com/openai/openai-node/releases/tag/v3.3.0",
    published_at: "2024-02-10T00:00:00Z",
    prerelease: false,
    draft: false,
  },
  {
    tag_name: "v4.9.0-beta.1",
    name: "4.9.0-beta.1",
    body: "prerelease",
    html_url: "https://github.com/openai/openai-node/releases/tag/v4.9.0-beta.1",
    published_at: "2026-08-02T00:00:00Z",
    prerelease: true,
    draft: false,
  },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", etag: '"gh-1"' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGitHubReleasesAdapter", () => {
  it("rejects unknown vendors", () => {
    expect(() => createGitHubReleasesAdapter("acme")).toThrow(/No GitHub repo mapping/);
  });

  it("skips drafts and prereleases and strips the v prefix", async () => {
    const adapter = createGitHubReleasesAdapter("openai");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(RELEASES)));

    const result = await adapter.fetch();
    const versions = result.evidence.map((ev) => ev.version);
    expect(versions).toEqual(["3.3.0", "4.0.0", "4.8.1"]);
    expect(result.evidence[0]!.previousVersion).toBeUndefined();
    expect(result.evidence[1]!.previousVersion).toBe("3.3.0");
    expect(result.evidence[2]!.previousVersion).toBe("4.0.0");
    expect(result.cursor).toMatchObject({ etag: '"gh-1"', latestTag: "v4.8.1" });
  });

  it("is conditional via If-None-Match and returns empty on 304", async () => {
    const adapter = createGitHubReleasesAdapter("openai");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 304, headers: { etag: '"gh-1"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.fetch({ etag: '"gh-1"' });
    expect(result.evidence).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("repos/openai/openai-node/releases"),
      expect.objectContaining({ headers: expect.objectContaining({ "If-None-Match": '"gh-1"' }) }),
    );
  });

  it("emits only releases published after the cursor", async () => {
    const adapter = createGitHubReleasesAdapter("openai");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(RELEASES)));

    const result = await adapter.fetch({
      etag: '"gh-1"',
      latestTag: "v4.0.0",
      latestPublishedAt: "2025-06-01T00:00:00Z",
    });
    const versions = result.evidence.map((ev) => ev.version);
    expect(versions).toEqual(["4.8.1"]);
    expect(result.evidence[0]!.previousVersion).toBe("4.0.0");
  });
});
