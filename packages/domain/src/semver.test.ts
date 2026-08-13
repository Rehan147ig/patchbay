import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion, satisfiesRange } from "./semver";

describe("parseVersion", () => {
  it("parses plain and prerelease versions", () => {
    expect(parseVersion("3.3.0")).toEqual({ major: 3, minor: 3, patch: 0, prerelease: null });
    expect(parseVersion("22.5.0")).toEqual({ major: 22, minor: 5, patch: 0, prerelease: null });
    expect(parseVersion("4.0.0-beta.2")).toEqual({
      major: 4,
      minor: 0,
      patch: 0,
      prerelease: "beta.2",
    });
  });

  it("rejects opaque strings", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("4")).toBeNull();
    expect(parseVersion("not-a-version")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders versions deterministically", () => {
    expect(compareVersions("3.3.0", "3.3.0")).toBe(0);
    expect(compareVersions("3.3.0", "4.0.0")).toBeLessThan(0);
    expect(compareVersions("4.0.0", "3.3.0")).toBeGreaterThan(0);
    expect(compareVersions("3.10.0", "3.9.9")).toBeGreaterThan(0);
    expect(compareVersions("4.0.0-rc.1", "4.0.0")).toBeLessThan(0);
  });

  it("returns null for opaque input", () => {
    expect(compareVersions("latest", "4.0.0")).toBeNull();
  });
});

describe("satisfiesRange", () => {
  it("exact and wildcard ranges", () => {
    expect(satisfiesRange("3.3.0", "3.3.0")).toBe(true);
    expect(satisfiesRange("3.3.1", "3.3.0")).toBe(false);
    expect(satisfiesRange("3.3.0", "*")).toBe(true);
    expect(satisfiesRange("3.3.0", "")).toBe(false);
  });

  it("caret and tilde ranges", () => {
    expect(satisfiesRange("3.4.0", "^3.3.0")).toBe(true);
    expect(satisfiesRange("4.0.0", "^3.3.0")).toBe(false);
    expect(satisfiesRange("3.3.9", "~3.3.0")).toBe(true);
    expect(satisfiesRange("3.4.0", "~3.3.0")).toBe(false);
  });

  it("stable ranges never admit prerelease versions", () => {
    expect(satisfiesRange("4.0.0-beta.1", "^4.0.0")).toBe(false);
    expect(satisfiesRange("4.0.0-beta.1", "~4.0.0")).toBe(false);
    expect(satisfiesRange("4.0.0-rc.1", "^4.0.0")).toBe(false);
    expect(satisfiesRange("13.0.0-rc.1", "~13.0.0")).toBe(false);
    expect(satisfiesRange("4.0.0-rc.1", ">=4.0.0")).toBe(false);
  });

  it("prerelease ranges admit only the same identifier", () => {
    expect(satisfiesRange("4.0.0-beta.1", "^4.0.0-beta.1")).toBe(true);
    expect(satisfiesRange("4.0.0-beta.2", "^4.0.0-beta.1")).toBe(false);
    expect(satisfiesRange("4.0.0", "^4.0.0-beta.1")).toBe(false);
    expect(satisfiesRange("4.0.0-rc.1", "^4.0.0-beta.1")).toBe(false);
    expect(satisfiesRange("4.0.0-beta.1", "4.0.0-beta.1")).toBe(true);
  });

  it("comparison prefixes and spans", () => {
    expect(satisfiesRange("4.1.0", ">=4.0.0")).toBe(true);
    expect(satisfiesRange("3.9.0", ">=4.0.0")).toBe(false);
    expect(satisfiesRange("6.0.0", "<7.0.0")).toBe(true);
    expect(satisfiesRange("7.0.0", "<7.0.0")).toBe(false);
    expect(satisfiesRange("5.2.1", "4.0.0 - 6.0.0")).toBe(true);
    expect(satisfiesRange("7.0.0", "4.0.0 - 6.0.0")).toBe(false);
  });

  it("AND-composed pairs and unsupported compounds", () => {
    expect(satisfiesRange("3.3.0", ">=3.0.0 <4.0.0")).toBe(true);
    expect(satisfiesRange("4.4.0", ">=3.0.0 <4.0.0")).toBe(false);
    expect(satisfiesRange("2.9.0", ">=3.0.0 <4.0.0")).toBe(false);
    expect(satisfiesRange("4.4.0", ">=3.0.0 <4.0.0 !=4.2.0")).toBe(false);
  });

  it("returns false for nullish or opaque ranges", () => {
    expect(satisfiesRange("4.0.0", null)).toBe(false);
    expect(satisfiesRange("4.0.0", undefined)).toBe(false);
    expect(satisfiesRange("4.0.0", "latest")).toBe(false);
  });
});
