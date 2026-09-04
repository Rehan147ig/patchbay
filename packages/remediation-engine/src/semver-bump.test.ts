import { describe, expect, it } from "vitest";
import { GenerationMethod } from "@patchbay/domain";
import { applySemverBump, buildSemverBumpPatch, findManifestBumpSpec } from "./semver-bump";

const MANIFEST = `{
  "name": "acme-web",
  "version": "1.0.0",
  "dependencies": {
    "lodash": "^4.17.20",
    "react": "~18.2.0",
    "left-pad": "1.3.0"
  },
  "devDependencies": {
    "vitest": ">=1.0.0"
  }
}
`;

describe("findManifestBumpSpec", () => {
  it("locates simple specs across sections", () => {
    expect(findManifestBumpSpec(MANIFEST, "lodash")).toMatchObject({
      section: "dependencies",
      fromSpec: "^4.17.20",
    });
    expect(findManifestBumpSpec(MANIFEST, "vitest")).toMatchObject({
      section: "devDependencies",
      fromSpec: ">=1.0.0",
    });
  });

  it("refuses complex specs, missing packages, and non-JSON", () => {
    expect(findManifestBumpSpec(MANIFEST, "no-such-pkg")).toBeNull();
    expect(findManifestBumpSpec("not json", "lodash")).toBeNull();
    const complex = JSON.stringify({ dependencies: { lodash: ">=4.0.0 <5.0.0" } });
    expect(findManifestBumpSpec(complex, "lodash")).toBeNull();
    const tagged = JSON.stringify({ dependencies: { lodash: "latest" } });
    expect(findManifestBumpSpec(tagged, "lodash")).toBeNull();
  });
});

describe("applySemverBump", () => {
  it("bumps the version core while preserving the range prefix", () => {
    expect(applySemverBump(MANIFEST, "lodash", "4.17.21")).toContain('"lodash": "^4.17.21"');
    expect(applySemverBump(MANIFEST, "react", "18.3.0")).toContain('"react": "~18.3.0"');
    expect(applySemverBump(MANIFEST, "left-pad", "1.3.1")).toContain('"left-pad": "1.3.1"');
    expect(applySemverBump(MANIFEST, "vitest", "1.1.0")).toContain('"vitest": ">=1.1.0"');
  });

  it("leaves everything else byte-identical", () => {
    const patched = applySemverBump(MANIFEST, "lodash", "4.17.21")!;
    expect(patched).toContain('"name": "acme-web"');
    expect(patched).toContain('"react": "~18.2.0"');
    // Only the lodash line changed.
    const changed = patched.split("\n").filter((line, i) => line !== MANIFEST.split("\n")[i]);
    expect(changed).toHaveLength(1);
  });

  it("refuses ambiguous or unprovable edits", () => {
    expect(applySemverBump(MANIFEST, "no-such-pkg", "9.9.9")).toBeNull();
    // Same package pinned twice: never guess which occurrence.
    const dup = MANIFEST.replace('"vitest": ">=1.0.0"', '"lodash": "^4.17.20"');
    expect(applySemverBump(dup, "lodash", "4.17.21")).toBeNull();
  });
});

describe("buildSemverBumpPatch", () => {
  it("builds a RULE_BASED patch draft for patch/minor moves", () => {
    const patch = buildSemverBumpPatch({
      manifestText: MANIFEST,
      packageName: "lodash",
      fromVersion: "4.17.20",
      toVersion: "4.17.21",
    })!;
    expect(patch.filePath).toBe("package.json");
    expect(patch.generationMethod).toBe(GenerationMethod.RULE_BASED);
    expect(patch.confidence).toBe(95);
    expect(patch.originalHash).not.toBe(patch.patchedHash);
    expect(patch.unifiedDiff).toContain("4.17.21");

    const minor = buildSemverBumpPatch({
      manifestText: MANIFEST,
      packageName: "react",
      fromVersion: "18.2.0",
      toVersion: "18.3.0",
    })!;
    expect(minor.confidence).toBe(85);
  });

  it("refuses majors, unknowns, and unprovable manifests", () => {
    expect(
      buildSemverBumpPatch({
        manifestText: MANIFEST,
        packageName: "lodash",
        fromVersion: "4.17.21",
        toVersion: "5.0.0",
      }),
    ).toBeNull();
    expect(
      buildSemverBumpPatch({
        manifestText: MANIFEST,
        packageName: "lodash",
        fromVersion: "4.17.20",
        toVersion: "latest",
      }),
    ).toBeNull();
    expect(
      buildSemverBumpPatch({
        manifestText: MANIFEST,
        packageName: "no-such-pkg",
        fromVersion: "1.0.0",
        toVersion: "1.0.1",
      }),
    ).toBeNull();
  });
});
