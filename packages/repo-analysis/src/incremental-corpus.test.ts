import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractGraph } from "./graph";
import { computeReextractionSet, inverseIndex, type InvalidationResult } from "./invalidation";
import { mergeIncrementalExtraction, nodeComparisonKey, edgeComparisonKey } from "./merge";
import { resolveFixtureDir } from "./fixtures";

const FIXTURES = [
  { name: "openai-node-legacy", leaf: "src/lib/logger.ts", popular: "src/lib/openai-client.ts" },
  { name: "stripe-node-legacy", leaf: "src/lib/logger.ts", popular: "src/lib/stripe-client.ts" },
  { name: "twilio-node-legacy", leaf: "src/lib/logger.ts", popular: "src/lib/twilio-client.ts" },
  { name: "auth0-node-legacy", leaf: "src/lib/logger.ts", popular: "src/middleware/authn.ts" },
];

function tempCopy(fixtureDir: string): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "patchbay-corpus-"));
  cpSync(fixtureDir, workspace, {
    recursive: true,
    filter: (source) => !source.includes("node_modules"),
  });
  return workspace;
}

function mutateFile(root: string, relPath: string, marker: string): void {
  const target = path.join(root, relPath);
  const content = readFileSync(target, "utf8");
  writeFileSync(target, `${content}\n// wp5-mutation:${marker}\n`, "utf8");
}

describe("WP5 full-vs-incremental comparator corpus", () => {
  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      it("incremental output equals a clean full extraction after a leaf-file change", async () => {
        const root = resolveFixtureDir(fixture.name);
        const baseline = await extractGraph({
          rootDir: root,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
        });
        const { reverseImports, reverseCalls } = inverseIndex(baseline);
        const allFiles = [
          ...new Set(
            baseline.nodeFacts
              .map((node) => node.filePath)
              .filter((file): file is string => file !== null),
          ),
        ];

        const leaf = fixture.leaf;
        const result: InvalidationResult = computeReextractionSet({
          changedFiles: [leaf],
          reverseImports,
          reverseCalls,
          allFiles,
        });

        expect(result.reextract).toContain(leaf);
        expect(result.reextract.length).toBeLessThan(allFiles.length);

        const mutated = tempCopy(root);
        mutateFile(mutated, leaf, fixture.name);
        const oracle = await extractGraph({
          rootDir: mutated,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
        });
        const incremental = await extractGraph({
          rootDir: mutated,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
          changedFiles: new Map(result.reextract.map((file) => [file, ""])),
        });
        const merged = mergeIncrementalExtraction(baseline, incremental, new Set(result.reextract));

        expect(merged.nodeFacts.map(nodeComparisonKey).sort()).toEqual(
          oracle.nodeFacts.map(nodeComparisonKey).sort(),
        );
        expect(merged.edgeFacts.map(edgeComparisonKey).sort()).toEqual(
          oracle.edgeFacts.map(edgeComparisonKey).sort(),
        );
        rmSync(mutated, { recursive: true, force: true });
      });

      it("invalidates reverse importers and still equals a clean full extraction", async () => {
        const root = resolveFixtureDir(fixture.name);
        const baseline = await extractGraph({
          rootDir: root,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
        });
        const { reverseImports, reverseCalls } = inverseIndex(baseline);
        const allFiles = [
          ...new Set(
            baseline.nodeFacts
              .map((node) => node.filePath)
              .filter((file): file is string => file !== null),
          ),
        ];

        const result: InvalidationResult = computeReextractionSet({
          changedFiles: [fixture.popular],
          reverseImports,
          reverseCalls,
          allFiles,
        });
        const importers = reverseImports.get(fixture.popular) ?? [];
        expect(result.invalidated.length).toBeGreaterThan(0);
        for (const importer of importers) {
          expect(result.reextract).toContain(importer);
        }

        const mutated = tempCopy(root);
        mutateFile(mutated, fixture.popular, fixture.name);
        const oracle = await extractGraph({
          rootDir: mutated,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
        });
        const incremental = await extractGraph({
          rootDir: mutated,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
          changedFiles: new Map(result.reextract.map((file) => [file, ""])),
        });
        const merged = mergeIncrementalExtraction(baseline, incremental, new Set(result.reextract));

        expect(merged.nodeFacts.map(nodeComparisonKey).sort()).toEqual(
          oracle.nodeFacts.map(nodeComparisonKey).sort(),
        );
        expect(merged.edgeFacts.map(edgeComparisonKey).sort()).toEqual(
          oracle.edgeFacts.map(edgeComparisonKey).sort(),
        );
        rmSync(mutated, { recursive: true, force: true });
      });

      it("treats a lockfile change as whole-repository invalidation and still equals full", async () => {
        const root = resolveFixtureDir(fixture.name);
        const baseline = await extractGraph({
          rootDir: root,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
        });
        const { reverseImports, reverseCalls } = inverseIndex(baseline);
        const allFiles = [
          ...new Set(
            baseline.nodeFacts
              .map((node) => node.filePath)
              .filter((file): file is string => file !== null),
          ),
        ];

        const result: InvalidationResult = computeReextractionSet({
          changedFiles: ["pnpm-lock.yaml"],
          reverseImports,
          reverseCalls,
          allFiles,
        });
        expect(result.invalidatingManifests).toEqual(["pnpm-lock.yaml"]);
        for (const file of allFiles) {
          expect(result.reextract).toContain(file);
        }

        const mutated = tempCopy(root);
        const lockfile = path.join(mutated, "pnpm-lock.yaml");
        writeFileSync(
          lockfile,
          `${readFileSync(lockfile, "utf8")}\n# wp5-lockfile-mutation\n`,
          "utf8",
        );
        const oracle = await extractGraph({
          rootDir: mutated,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
        });
        const incremental = await extractGraph({
          rootDir: mutated,
          trackPackages: ["openai", "stripe", "twilio", "auth0"],
          changedFiles: new Map(result.reextract.map((file) => [file, ""])),
        });
        const merged = mergeIncrementalExtraction(baseline, incremental, new Set(result.reextract));

        expect(merged.nodeFacts.map(nodeComparisonKey).sort()).toEqual(
          oracle.nodeFacts.map(nodeComparisonKey).sort(),
        );
        expect(merged.edgeFacts.map(edgeComparisonKey).sort()).toEqual(
          oracle.edgeFacts.map(edgeComparisonKey).sort(),
        );
        rmSync(mutated, { recursive: true, force: true });
      });
    });
  }

  it("inverseIndex only trusts EXTRACTED/RESOLVED CALLS for invalidation", () => {
    const index = inverseIndex({
      nodeFacts: [
        { key: "mod:a.ts", filePath: "a.ts" },
        { key: "mod:b.ts", filePath: "b.ts" },
      ],
      edgeFacts: [
        { kind: "IMPORTS", fromKey: "mod:a.ts", toKey: "mod:b.ts", provenance: "RESOLVED" },
        { kind: "CALLS", fromKey: "mod:b.ts", toKey: "mod:a.ts", provenance: "INFERRED" },
        { kind: "CALLS", fromKey: "mod:a.ts", toKey: "mod:b.ts", provenance: "EXTRACTED" },
      ],
    });
    expect(index.reverseImports.get("b.ts")).toEqual(["a.ts"]);
    expect(index.reverseCalls.get("b.ts")).toEqual(["a.ts"]);
    expect(index.reverseCalls.get("a.ts")).toBeUndefined();
  });

  it("propagates invalidation transitively through reverse edges", () => {
    const result = computeReextractionSet({
      changedFiles: ["c.ts"],
      reverseImports: new Map([
        ["c.ts", ["b.ts"]],
        ["b.ts", ["a.ts"]],
      ]),
      reverseCalls: new Map(),
      allFiles: ["a.ts", "b.ts", "c.ts"],
    });
    expect(result.reextract).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
