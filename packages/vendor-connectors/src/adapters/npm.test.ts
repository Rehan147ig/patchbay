import { afterEach, describe, expect, it, vi } from "vitest";
import { createNpmAdapter } from "./npm";

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
});
