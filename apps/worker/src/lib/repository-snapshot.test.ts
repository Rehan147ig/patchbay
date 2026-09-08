import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSnapshotManifest, manifestHashMap } from "@patchbay/git-provider";
import { bindSnapshotHashes, classifyBoundPlan } from "@patchbay/ai-harness";
import { applyBoundPlanToCheckout, collectSnapshotExcerpts } from "./repository-snapshot";

vi.mock("@patchbay/db", () => ({ prisma: {}, packageImpact: vi.fn() }));
vi.mock("@patchbay/env", () => ({ getSecretStore: vi.fn() }));
vi.mock("@patchbay/repo-analysis", () => ({
  resolveFixtureDir: (name: string) => `fixtures/${name}`,
}));

function makeCheckout(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "patchbay-apply-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(dir, filePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("snapshot patch application", () => {
  it("binds a connected-repo-style snapshot to real hashes and yields artifacts", () => {
    const dir = makeCheckout({ "src/a.ts": "import { a } from 'openai';\na();\n" });
    try {
      const manifest = buildSnapshotManifest(dir);
      const plan = {
        releaseRecordId: "r-1",
        repositoryId: "repo-1",
        rationale: "rename",
        confidence: 85,
        requiresHumanReview: true,
        riskLevel: "LOW" as const,
        riskTags: [],
        edits: [
          {
            filePath: "src/a.ts",
            expectedSourceHash: "0".repeat(64),
            operation: "REPLACE" as const,
            searchText: "a()",
            replacement: "b()",
            description: "rename call",
            confidence: 90,
          },
        ],
        validationProfile: [],
        addressedSymbols: ["a"],
      };
      const bound = bindSnapshotHashes(plan, manifestHashMap(manifest));
      expect(bound.invalidated).toEqual([]);
      const artifacts = applyBoundPlanToCheckout(dir, manifest, bound.plan);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]?.patchedContent).toContain("b()");
      expect(artifacts[0]?.originalHash).toBe(sha("import { a } from 'openai';\na();\n"));
      expect(artifacts[0]?.unifiedDiff).toContain("b()");
      // Stable diff hashes: re-applying the same bound plan to a fresh
      // checkout of the same content yields identical hashes.
      const dir2 = makeCheckout({ "src/a.ts": "import { a } from 'openai';\na();\n" });
      try {
        const manifest2 = buildSnapshotManifest(dir2);
        const bound2 = bindSnapshotHashes(plan, manifestHashMap(manifest2));
        const artifacts2 = applyBoundPlanToCheckout(dir2, manifest2, bound2.plan);
        expect(artifacts2[0]?.patchedHash).toBe(artifacts[0]?.patchedHash);
        expect(artifacts2[0]?.unifiedDiff).toBe(artifacts[0]?.unifiedDiff);
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invalidates missing, stale, traversal, and changed-checkout targets (no artifact, no PR)", () => {
    const dir = makeCheckout({ "src/a.ts": "hello\n" });
    try {
      const manifest = buildSnapshotManifest(dir);
      const map = manifestHashMap(manifest);
      const staleHash = "c".repeat(64);
      const cases = [
        { filePath: "src/missing.ts", expectedSourceHash: "0".repeat(64) },
        { filePath: "src/a.ts", expectedSourceHash: staleHash },
        { filePath: "../escape.ts", expectedSourceHash: "0".repeat(64) },
        { filePath: "/abs.ts", expectedSourceHash: "0".repeat(64) },
      ];
      for (const item of cases) {
        const bound = bindSnapshotHashes(
          {
            releaseRecordId: "r-1",
            repositoryId: "repo-1",
            rationale: "t",
            confidence: 80,
            requiresHumanReview: true,
            riskLevel: "LOW" as const,
            riskTags: [],
            edits: [
              {
                filePath: item.filePath,
                expectedSourceHash: item.expectedSourceHash,
                operation: "REPLACE" as const,
                searchText: "hello",
                replacement: "bye",
                description: "x",
                confidence: 90,
              },
            ],
            validationProfile: [],
            addressedSymbols: [],
          },
          map,
        );
        expect(bound.plan.edits).toHaveLength(0);
        expect(bound.invalidated).toHaveLength(1);
        expect(classifyBoundPlan(0, 1).outcome).toBe("PLAN_ONLY");
      }
      // Changed checkout between analysis and apply fails closed.
      const good = bindSnapshotHashes(
        {
          releaseRecordId: "r-1",
          repositoryId: "repo-1",
          rationale: "t",
          confidence: 80,
          requiresHumanReview: true,
          riskLevel: "LOW" as const,
          riskTags: [],
          edits: [
            {
              filePath: "src/a.ts",
              expectedSourceHash: "0".repeat(64),
              operation: "REPLACE" as const,
              searchText: "hello",
              replacement: "bye",
              description: "x",
              confidence: 90,
            },
          ],
          validationProfile: [],
          addressedSymbols: [],
        },
        map,
      );
      writeFileSync(path.join(dir, "src/a.ts"), "someone else changed me\n");
      expect(() => applyBoundPlanToCheckout(dir, manifest, good.plan)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("zero-edit plans become PLAN_ONLY, never PATCH_PROPOSED", () => {
    expect(classifyBoundPlan(0, 0)).toEqual(expect.objectContaining({ outcome: "PLAN_ONLY" }));
  });

  it("changes only declared files", () => {
    const dir = makeCheckout({ "src/a.ts": "a();\n", "src/b.ts": "b();\n" });
    try {
      const manifest = buildSnapshotManifest(dir);
      const bound = bindSnapshotHashes(
        {
          releaseRecordId: "r-1",
          repositoryId: "repo-1",
          rationale: "t",
          confidence: 80,
          requiresHumanReview: true,
          riskLevel: "LOW" as const,
          riskTags: [],
          edits: [
            {
              filePath: "src/a.ts",
              expectedSourceHash: "0".repeat(64),
              operation: "REPLACE" as const,
              searchText: "a()",
              replacement: "a2()",
              description: "x",
              confidence: 90,
            },
          ],
          validationProfile: [],
          addressedSymbols: [],
        },
        manifestHashMap(manifest),
      );
      applyBoundPlanToCheckout(dir, manifest, bound.plan);
      expect(readFileSync(path.join(dir, "src/a.ts"), "utf8")).toContain("a2()");
      expect(readFileSync(path.join(dir, "src/b.ts"), "utf8")).toBe("b();\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collects bounded excerpts from impacted files only", () => {
    const dir = makeCheckout({ "src/a.ts": "x".repeat(5000), "src/b.ts": "y\n" });
    try {
      const excerpts = collectSnapshotExcerpts(dir, ["src/a.ts", "src/b.ts", "../evil.ts"]);
      expect(excerpts.map((item) => item.filePath).sort()).toEqual(["src/a.ts", "src/b.ts"]);
      expect(
        excerpts.find((item) => item.filePath === "src/a.ts")!.excerpt.length,
      ).toBeLessThanOrEqual(2000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
