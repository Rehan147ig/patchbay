import { describe, expect, it } from "vitest";
import {
  authenticityForSource,
  trustProfileFor,
  trustProfiles,
  validateAdapterCursor,
} from "./trust";

describe("trust profiles", () => {
  it("maps adapter slugs to the matching profile", () => {
    expect(trustProfileFor("npm:openai").allowedDomains).toEqual(["registry.npmjs.org"]);
    expect(trustProfileFor("github-releases:stripe").allowedDomains).toEqual(["api.github.com"]);
    expect(trustProfileFor("openapi:stripe").allowedDomains).toEqual(["api.stripe.com"]);
  });

  it("fails closed for unknown adapters: no domains, signatures required, evidence unverified", () => {
    const profile = trustProfileFor("mystery:vendor");
    expect(profile.allowedDomains).toEqual([]);
    expect(profile.allowRedirects).toBe(false);
    expect(profile.requireSignature).toBe(true);
    expect(profile.evidenceAuthenticity).toBe("UNVERIFIED");
  });

  it("exposes the full profile set for detector health views", () => {
    const profiles = trustProfiles();
    expect(profiles.map((p) => p.adapterPrefix)).toEqual(["npm:", "github-releases:", "openapi:"]);
    for (const p of profiles) {
      expect(p.maxResponseBytes).toBeGreaterThan(0);
      expect(p.timeoutMs).toBeGreaterThan(0);
      expect(p.cadenceMs).toBeGreaterThan(0);
    }
  });

  it("maps evidence authenticity per source: OpenAPI observations are never trusted", () => {
    expect(authenticityForSource("NPM")).toBe("SOURCE_TRUSTED");
    expect(authenticityForSource("GITHUB_RELEASE")).toBe("SOURCE_TRUSTED");
    expect(authenticityForSource("OPENAPI")).toBe("UNVERIFIED");
    expect(authenticityForSource("CHANGELOG" as never)).toBe("UNVERIFIED");
  });
});

describe("validateAdapterCursor", () => {
  it("accepts null/undefined cursors (first poll)", () => {
    expect(validateAdapterCursor("npm:openai", null)).toEqual([]);
    expect(validateAdapterCursor("npm:openai", undefined)).toEqual([]);
  });

  it("rejects non-object cursors", () => {
    expect(validateAdapterCursor("npm:openai", "bad")).toContain("cursor must be a JSON object");
    expect(validateAdapterCursor("npm:openai", ["etag"])).toContain("cursor must be a JSON object");
  });

  it("validates npm cursor shape", () => {
    expect(
      validateAdapterCursor("npm:openai", {
        etag: '"x"',
        latestVersion: "4.8.1",
        seenVersions: ["4.8.1"],
      }),
    ).toEqual([]);
    expect(validateAdapterCursor("npm:openai", { etag: 42, latestVersion: "4.8.1" })).toEqual(
      expect.arrayContaining([
        "npm cursor requires string etag",
        "npm cursor requires seenVersions (string[])",
      ]),
    );
  });

  it("validates github cursor shape", () => {
    expect(
      validateAdapterCursor("github-releases:stripe", {
        etag: '"x"',
        latestTag: "v12.0.0",
        latestPublishedAt: "2026-08-01T00:00:00Z",
      }),
    ).toEqual([]);
    expect(validateAdapterCursor("github-releases:stripe", { etag: null })).toContain(
      "github cursor requires string etag",
    );
  });

  it("validates openapi cursor shape", () => {
    expect(
      validateAdapterCursor("openapi:stripe", {
        etag: '"x"',
        lastContentHash: "abc",
        lastSpec: {},
      }),
    ).toEqual([]);
    expect(validateAdapterCursor("openapi:stripe", { etag: '"x"', lastContentHash: 7 })).toContain(
      "openapi cursor requires lastContentHash (string|null)",
    );
  });
});
