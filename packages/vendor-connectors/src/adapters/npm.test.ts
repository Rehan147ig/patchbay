import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNpmAdapter,
  fetchNpmLatestVersion,
  getNpmRegistryUrl,
  npmRegistryAuthHeaders,
} from "./npm";

const PACKUMENT = {
  "dist-tags": { latest: "4.8.1" },
  versions: {
    "3.3.0": {},
    "4.0.0": {},
    "4.8.1": {},
  },
  time: {
    created: "2023-01-01T00:00:00.000Z",
    modified: "2026-08-01T00:00:00.000Z",
    "3.3.0": "2024-02-10T00:00:00.000Z",
    "4.0.0": "2025-06-01T00:00:00.000Z",
    "4.8.1": "2026-08-01T00:00:00.000Z",
  },
};

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", etag: '"abc123"', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("createNpmAdapter", () => {
  it("rejects unknown vendors", () => {
    expect(() => createNpmAdapter("not-a-vendor")).toThrow(/No npm package mapping/);
  });

  it("supports only its own vendor package inputs", () => {
    const adapter = createNpmAdapter("openai");
    expect(adapter.supports({ vendorSlug: "openai", packageName: "openai" })).toBe(true);
    expect(adapter.supports({ vendorSlug: "stripe", packageName: "openai" })).toBe(false);
    expect(adapter.supports("openai")).toBe(false);
  });

  it("normalizes a raw input into a release", () => {
    const adapter = createNpmAdapter("openai");
    const normalized = adapter.normalize({
      vendorSlug: "openai",
      packageName: "openai",
      version: "3.3.0",
      contentHash: "deadbeef",
      publishedAt: "2024-02-10T00:00:00.000Z",
    });
    expect(normalized.version).toBe("3.3.0");
    expect(normalized.source).toBe("NPM");
    expect(normalized.canonicalUrl).toBe("https://www.npmjs.com/package/openai/v/3.3.0");
  });

  it("emits every version newer than the cursor with previousVersion", async () => {
    const adapter = createNpmAdapter("openai");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PACKUMENT)));

    const result = await adapter.fetch();
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence.map((ev) => ev.version)).toEqual(["3.3.0", "4.0.0", "4.8.1"]);
    expect(result.evidence[0]!.previousVersion).toBeUndefined();
    expect(result.evidence[1]!.previousVersion).toBe("3.3.0");
    expect(result.evidence[2]!.previousVersion).toBe("4.0.0");
    expect(result.cursor).toMatchObject({ etag: '"abc123"', latestVersion: "4.8.1" });
  });

  it("sends If-None-Match and returns empty on 304", async () => {
    const adapter = createNpmAdapter("openai");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { etag: '"abc123"' },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.fetch({ etag: '"abc123"' });
    expect(result.evidence).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://registry.npmjs.org/openai"),
      expect.objectContaining({
        headers: expect.objectContaining({ "If-None-Match": '"abc123"' }),
      }),
    );
  });

  it("does not re-emit versions already seen", async () => {
    const adapter = createNpmAdapter("openai");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PACKUMENT))),
    );

    await adapter.fetch();
    const second = await adapter.fetch({
      etag: '"abc123"',
      latestVersion: null,
      seenVersions: ["3.3.0", "4.0.0", "4.8.1"],
    });
    expect(second.evidence).toEqual([]);
  });

  it("tolerates a legacy cursor written before seenVersions existed", async () => {
    // Regression: persisted cursors from older adapter versions lack
    // seenVersions; the poll must treat them as empty, never crash.
    const adapter = createNpmAdapter("openai");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PACKUMENT)));

    const result = await adapter.fetch({ etag: '"legacy"', latestVersion: "4.8.1" } as never);
    expect(result.evidence.map((ev) => ev.version)).toEqual(["3.3.0", "4.0.0", "4.8.1"]);
    // publishedVersions are newest-first, and the cursor keeps that order.
    expect((result.cursor as { seenVersions: string[] }).seenVersions).toEqual([
      "4.8.1",
      "4.0.0",
      "3.3.0",
    ]);
  });

  it("bounds cursor growth by keeping only the newest seen versions", async () => {
    const adapter = createNpmAdapter("openai");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PACKUMENT)));

    const oldSeen = Array.from({ length: 60 }, (_, i) => `0.0.${i}`);
    const result = await adapter.fetch({
      etag: null,
      latestVersion: null,
      seenVersions: oldSeen,
    } as never);
    const seen = (result.cursor as { seenVersions: string[] }).seenVersions;
    expect(seen.length).toBeLessThanOrEqual(50);
    expect(seen).toContain("4.8.1");
    expect(seen).not.toContain("0.0.0");
  });

  it("defaults to the public registry when unconfigured", async () => {
    expect(getNpmRegistryUrl({} as NodeJS.ProcessEnv)).toBe("https://registry.npmjs.org");
    const adapter = createNpmAdapter("openai");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PACKUMENT));
    vi.stubGlobal("fetch", fetchMock);

    await adapter.fetch();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://registry.npmjs.org/openai"),
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
    );
  });

  it("polls the private mirror with bearer auth when configured", async () => {
    vi.stubEnv(
      "NPM_REGISTRY_URL",
      "https://artifactory.internal.example.com/artifactory/api/npm/npm/",
    );
    vi.stubEnv("NPM_REGISTRY_TOKEN", "mirror-secret");
    expect(getNpmRegistryUrl()).toBe(
      "https://artifactory.internal.example.com/artifactory/api/npm/npm",
    );
    expect(npmRegistryAuthHeaders()).toEqual({ Authorization: "Bearer mirror-secret" });

    const adapter = createNpmAdapter("openai");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PACKUMENT));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.fetch();
    expect(result.evidence).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://artifactory.internal.example.com/artifactory/api/npm/npm/openai"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.npm.install-v1+json",
          Authorization: "Bearer mirror-secret",
        }),
      }),
    );
  });

  it("falls back to basic auth and rejects http mirrors outside tests", async () => {
    vi.stubEnv("NPM_REGISTRY_URL", "https://nexus.internal.example.com/repository/npm/");
    vi.stubEnv("NPM_REGISTRY_AUTH", "dXNlcjpwYXNz");
    expect(npmRegistryAuthHeaders()).toEqual({ Authorization: "Basic dXNlcjpwYXNz" });

    // Bearer wins when both are set.
    vi.stubEnv("NPM_REGISTRY_TOKEN", "tok");
    expect(npmRegistryAuthHeaders()).toEqual({ Authorization: "Bearer tok" });
    vi.stubEnv("NPM_REGISTRY_TOKEN", "");

    await expect(
      import("../trust").then((m) =>
        m.privateNpmRegistryHost({
          NPM_REGISTRY_URL: "http://insecure.internal.example.com",
          NODE_ENV: "production",
        } as NodeJS.ProcessEnv),
      ),
    ).rejects.toThrow(/must use https/);
  });

  it("trusts the mirror host only when configured", async () => {
    const { fetchWithTrust } = await import("../safe-fetch");
    const { resolveNpmTrustProfile } = await import("../trust");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PACKUMENT));
    vi.stubGlobal("fetch", fetchMock);
    const target = new URL(
      "https://artifactory.internal.example.com/artifactory/api/npm/npm/openai",
    );

    // Unconfigured: the mirror host is rejected.
    await expect(
      fetchWithTrust(target.toString(), resolveNpmTrustProfile({} as NodeJS.ProcessEnv)),
    ).rejects.toThrow(/not in the trust profile allowlist/);

    // Configured: the same host is allowlisted.
    vi.stubEnv(
      "NPM_REGISTRY_URL",
      "https://artifactory.internal.example.com/artifactory/api/npm/npm",
    );
    const result = await fetchWithTrust(target.toString(), resolveNpmTrustProfile());
    expect(typeof result === "object" && result !== null && result.status).toBe(200);
  });
});

describe("fetchNpmLatestVersion", () => {
  it("returns the latest version and its publish date for any package", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PACKUMENT)));
    const latest = await fetchNpmLatestVersion("openai");
    expect(latest?.version).toBe("4.8.1");
    expect(latest?.publishedAt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("fails loudly when the package does not exist (callers skip the dep)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
    await expect(fetchNpmLatestVersion("no-such-pkg")).rejects.toMatchObject({
      reason: "non_ok_status",
    });
  });
});
