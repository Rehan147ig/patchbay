import { afterEach, describe, expect, it, vi } from "vitest";
import { createOsvAdapter, osvFixedVersion, osvMaxScore } from "./osv";
import { OSV_TRUST_PROFILE, trustProfileFor } from "../trust";

const FIXABLE_VULN = {
  id: "GHSA-xxxx-yyyy-zzzz",
  summary: "Command injection in lodash.template",
  published: "2024-05-01T00:00:00Z",
  severity: [{ type: "CVSS_V3", score: "9.8" }],
  affected: [
    {
      package: { name: "lodash", ecosystem: "npm" },
      ranges: [
        {
          type: "SEMVER",
          events: [{ introduced: "0" }, { fixed: "4.17.21" }],
        },
      ],
    },
  ],
};

const UNFIXED_VULN = {
  id: "GHSA-aaaa-bbbb-cccc",
  summary: "No fix available yet",
  published: "2024-06-01T00:00:00Z",
  severity: [{ type: "CVSS_V3", score: "5.3" }],
  affected: [
    {
      package: { name: "lodash", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "4.17.0" }] }],
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OSV trust profile", () => {
  it("pins api.osv.dev with path restriction and MEDIUM confidence", () => {
    expect(trustProfileFor("osv:lodash")).toBe(OSV_TRUST_PROFILE);
    expect(OSV_TRUST_PROFILE.allowedDomains).toEqual(["api.osv.dev"]);
    expect(OSV_TRUST_PROFILE.allowedPathPrefixes).toEqual(["/v1/"]);
    expect(OSV_TRUST_PROFILE.allowRedirects).toBe(false);
    expect(OSV_TRUST_PROFILE.evidenceAuthenticity).toBe("SOURCE_TRUSTED");
    expect(OSV_TRUST_PROFILE.evidenceConfidence).toBe("MEDIUM");
    expect(OSV_TRUST_PROFILE.sources).toEqual(["NPM"]);
  });
});

describe("osv helpers", () => {
  it("extracts the minimum fixed version and max severity score", () => {
    expect(osvFixedVersion(FIXABLE_VULN)).toBe("4.17.21");
    expect(osvMaxScore(FIXABLE_VULN)).toBe(9.8);
    expect(osvFixedVersion(UNFIXED_VULN)).toBeNull();
    expect(osvMaxScore({})).toBeNull();
  });
});

describe("createOsvAdapter", () => {
  it("emits one evidence per new vuln with the fix as the version", async () => {
    const adapter = createOsvAdapter({
      ecosystem: "npm",
      packageName: "lodash",
      installedVersion: "4.17.20",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ vulns: [FIXABLE_VULN, UNFIXED_VULN] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.fetch();
    expect(result.evidence).toHaveLength(2);

    const [fixable, unfixed] = result.evidence;
    expect(fixable!.externalId).toBe("osv:lodash@4.17.20#GHSA-xxxx-yyyy-zzzz");
    expect(fixable!.version).toBe("4.17.21");
    expect(fixable!.previousVersion).toBe("4.17.20");
    expect(fixable!.source).toBe("NPM");
    expect(fixable!.canonicalUrl).toBe("https://osv.dev/vulnerability/GHSA-xxxx-yyyy-zzzz");
    expect(fixable!.metadata).toMatchObject({
      discovery: "OSV",
      fixedVersion: "4.17.21",
      hasFix: true,
      severityScore: 9.8,
    });

    // No fixed version: still emitted as intel, version stays installed.
    expect(unfixed!.version).toBe("4.17.20");
    expect(unfixed!.metadata).toMatchObject({ hasFix: false, fixedVersion: null });

    expect(result.cursor).toMatchObject({
      seenVulnIds: ["GHSA-xxxx-yyyy-zzzz", "GHSA-aaaa-bbbb-cccc"],
    });

    // POSTs the package query to the OSV API.
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.osv.dev/v1/query"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          package: { name: "lodash", ecosystem: "npm" },
          version: "4.17.20",
        }),
      }),
    );
  });

  it("emits nothing for clean packages and never re-emits seen vulns", async () => {
    const adapter = createOsvAdapter({
      ecosystem: "npm",
      packageName: "left-pad",
      installedVersion: "1.3.0",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    const clean = await adapter.fetch();
    expect(clean.evidence).toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ vulns: [FIXABLE_VULN] })));
    const lodash = createOsvAdapter({
      ecosystem: "npm",
      packageName: "lodash",
      installedVersion: "4.17.20",
    });
    const second = await lodash.fetch({ seenVulnIds: ["GHSA-xxxx-yyyy-zzzz"], lastChecked: null });
    expect(second.evidence).toEqual([]);
  });

  it("fails loudly on non-OK responses", async () => {
    const adapter = createOsvAdapter({
      ecosystem: "npm",
      packageName: "lodash",
      installedVersion: "4.17.20",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 500 })));
    await expect(adapter.fetch()).rejects.toMatchObject({ reason: "non_ok_status" });
  });

  it("supports OSV-shaped inputs and normalizes to a release", () => {
    const adapter = createOsvAdapter({
      ecosystem: "npm",
      packageName: "lodash",
      installedVersion: "4.17.20",
    });
    const input = {
      osv: true,
      packageName: "lodash",
      installedVersion: "4.17.20",
      vuln: FIXABLE_VULN,
      fixedVersion: "4.17.21",
      vulnId: "GHSA-xxxx-yyyy-zzzz",
      contentHash: "abc",
    };
    expect(adapter.supports(input)).toBe(true);
    expect(adapter.supports({ sdk: "stripe" })).toBe(false);
    const normalized = adapter.normalize(input);
    expect(normalized.version).toBe("4.17.21");
    expect(normalized.previousVersion).toBe("4.17.20");
    expect(normalized.source).toBe("NPM");
    expect(() => adapter.normalize({ sdk: "stripe" })).toThrow();
  });
});
