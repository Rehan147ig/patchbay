import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSnapshotManifest, manifestHashMap } from "@patchbay/git-provider";
import { bindSnapshotHashes, classifyBoundPlan } from "@patchbay/ai-harness";
import {
  SnapshotUnavailableError,
  applyBoundPlanToCheckout,
  buildSnapshotForRepository,
  checkoutSnapshotForApply,
  collectSnapshotExcerpts,
  expireRepositorySnapshots,
} from "./repository-snapshot";
import { prisma } from "@patchbay/db";

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

  it("requires exactly one anchor match by default (zero/one/multiple)", () => {
    const single = makeCheckout({ "src/a.ts": "foo();\n" });
    try {
      const manifest = buildSnapshotManifest(single);
      const base = {
        releaseRecordId: "r-1",
        repositoryId: "repo-1",
        rationale: "t",
        confidence: 80,
        requiresHumanReview: true,
        riskLevel: "LOW" as const,
        riskTags: [],
        validationProfile: [],
        addressedSymbols: [],
      };
      // One match: succeeds.
      const one = bindSnapshotHashes(
        {
          ...base,
          edits: [
            {
              filePath: "src/a.ts",
              expectedSourceHash: "0".repeat(64),
              operation: "REPLACE" as const,
              searchText: "foo()",
              replacement: "bar()",
              description: "x",
              confidence: 90,
            },
          ],
        },
        manifestHashMap(manifest),
      );
      expect(() => applyBoundPlanToCheckout(single, manifest, one.plan)).not.toThrow();
    } finally {
      rmSync(single, { recursive: true, force: true });
    }
    const zero = makeCheckout({ "src/a.ts": "nothing here\n" });
    try {
      const manifest = buildSnapshotManifest(zero);
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
              searchText: "missing-anchor",
              replacement: "x",
              description: "x",
              confidence: 90,
            },
          ],
          validationProfile: [],
          addressedSymbols: [],
        },
        manifestHashMap(manifest),
      );
      expect(() => applyBoundPlanToCheckout(zero, manifest, bound.plan)).toThrow(
        /anchor missing.*found 0/,
      );
    } finally {
      rmSync(zero, { recursive: true, force: true });
    }
    const multi = makeCheckout({ "src/a.ts": "foo();\nfoo();\nfoo();\n" });
    try {
      const manifest = buildSnapshotManifest(multi);
      const base = {
        releaseRecordId: "r-1",
        repositoryId: "repo-1",
        rationale: "t",
        confidence: 80,
        requiresHumanReview: true,
        riskLevel: "LOW" as const,
        riskTags: [],
        validationProfile: [],
        addressedSymbols: [],
      };
      // Default (single-anchor): three matches fail closed, no silent 3x rewrite.
      const ambiguous = bindSnapshotHashes(
        {
          ...base,
          edits: [
            {
              filePath: "src/a.ts",
              expectedSourceHash: "0".repeat(64),
              operation: "REPLACE" as const,
              searchText: "foo()",
              replacement: "bar()",
              description: "x",
              confidence: 90,
            },
          ],
        },
        manifestHashMap(manifest),
      );
      expect(() => applyBoundPlanToCheckout(multi, manifest, ambiguous.plan)).toThrow(
        /matches 3 locations.*expected exactly 1/,
      );
      // Explicit bounded multi-occurrence: declares N=3, replaces all three deterministically.
      const explicit = bindSnapshotHashes(
        {
          ...base,
          edits: [
            {
              filePath: "src/a.ts",
              expectedSourceHash: "0".repeat(64),
              operation: "REPLACE" as const,
              searchText: "foo()",
              replacement: "bar()",
              expectedOccurrences: 3,
              description: "x",
              confidence: 90,
            },
          ],
        },
        manifestHashMap(manifest),
      );
      const artifacts = applyBoundPlanToCheckout(multi, manifest, explicit.plan);
      expect(artifacts[0]?.patchedContent).toBe("bar();\nbar();\nbar();\n");
      // Wrong count declaration also fails closed.
      const wrong = bindSnapshotHashes(
        {
          ...base,
          edits: [
            {
              filePath: "src/a.ts",
              expectedSourceHash: "0".repeat(64),
              operation: "REPLACE" as const,
              searchText: "bar()",
              replacement: "baz()",
              expectedOccurrences: 2,
              description: "x",
              confidence: 90,
            },
          ],
        },
        manifestHashMap(buildSnapshotManifest(multi)),
      );
      expect(() =>
        applyBoundPlanToCheckout(multi, buildSnapshotManifest(multi), wrong.plan),
      ).toThrow(/expected exactly 2/);
    } finally {
      rmSync(multi, { recursive: true, force: true });
    }
  });
});

describe("snapshot commit pinning (P0-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses HEAD resolution: connected repos require expectedCommitSha (fail closed, zero checkout)", async () => {
    const repo = {
      id: "repo-1",
      organizationId: "org-1",
      provider: "GITHUB",
      fullName: "acme/app",
      defaultBranch: "main",
      metadata: { installationId: 123 },
    };
    await expect(buildSnapshotForRepository(repo, {})).rejects.toThrow(SnapshotUnavailableError);
    await expect(buildSnapshotForRepository(repo, {})).rejects.toThrow(/expectedCommitSha/);
  });

  it("checks out the analyzed commit even after main advances (injected provider)", async () => {
    const checkedOut: string[] = [];
    const dirA = makeCheckout({ "src/a.ts": "version A\n" });
    const treeHash = "t".repeat(16);
    const analyzedSha = "a".repeat(40);
    const advancedSha = "b".repeat(40);
    // Mock DB: installation owned, no existing snapshot, create returns new id.
    (prisma as unknown as Record<string, unknown>).gitHubInstallation = {
      findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
    };
    (prisma as unknown as Record<string, unknown>).repositorySnapshot = {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "snap-1" }),
    };
    const createProvider = vi.fn().mockResolvedValue({
      // resolveHeadSha would return the ADVANCED head, but the service must
      // never call it: checkout must receive the ANALYZED sha.
      resolveHeadSha: vi.fn().mockResolvedValue(advancedSha),
      checkout: vi.fn().mockImplementation(async (input: { sha: string }) => {
        checkedOut.push(input.sha);
        return { workspaceDir: dirA, treeHash };
      }),
    });
    try {
      const repo = {
        id: "repo-1",
        organizationId: "org-1",
        provider: "GITHUB",
        fullName: "acme/app",
        defaultBranch: "main",
        metadata: { installationId: 123 },
      };
      const built = await buildSnapshotForRepository(repo, {
        expectedCommitSha: analyzedSha,
        createProvider: createProvider as never,
      });
      expect(built.commitSha).toBe(analyzedSha);
      expect(checkedOut).toEqual([analyzedSha]);
      expect(checkedOut).not.toContain(advancedSha);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
    }
  });
});

describe("snapshot expiry (P1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses checkout of expired snapshots (marks EXPIRED, no patch)", async () => {
    const past = new Date(Date.now() - 1000);
    (prisma as unknown as Record<string, unknown>).repositorySnapshot = {
      findUnique: vi.fn().mockResolvedValue({
        id: "snap-exp",
        organizationId: "org-1",
        repositoryId: "repo-1",
        status: "READY",
        expiresAt: past,
        commitSha: "a".repeat(40),
        treeHash: "t".repeat(16),
        manifestHash: "m".repeat(64),
      }),
      update: vi.fn().mockResolvedValue({}),
    };
    await expect(
      checkoutSnapshotForApply("snap-exp", {
        id: "repo-1",
        organizationId: "org-1",
        provider: "LOCAL",
        fullName: null,
        defaultBranch: null,
        metadata: { fixture: "x" },
      }),
    ).rejects.toThrow(SnapshotUnavailableError);
  });

  it("retention sweep marks past-due READY rows EXPIRED", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    (prisma as unknown as Record<string, unknown>).repositorySnapshot = { updateMany };
    const result = await expireRepositorySnapshots(new Date("2030-01-01T00:00:00Z"));
    expect(result.expired).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "READY", expiresAt: { lt: new Date("2030-01-01T00:00:00Z") } },
      data: { status: "EXPIRED" },
    });
  });
});
