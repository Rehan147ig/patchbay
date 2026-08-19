import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@patchbay/db";
import { processScanRepository } from "./scan-repository";

vi.mock("@patchbay/db", () => ({
  prisma: {
    repository: { findUnique: vi.fn() },
    repositoryScan: { findUnique: vi.fn(), update: vi.fn() },
    vendor: { findMany: vi.fn() },
    integrationUsage: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    repositoryDependency: { createMany: vi.fn() },
    graphIndexJob: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  createNotification: vi.fn(),
  NotificationType: {
    SCAN_COMPLETED: "scan.completed",
    SCAN_FAILED: "scan.failed",
    CASE_CREATED: "case.created",
    PLAN_CREATED: "plan.created",
    PR_CREATED: "pull_request.created",
    CAPABILITY_GATE_SUSPENDED: "capability_gate.suspended",
  },
}));

vi.mock("@patchbay/repo-analysis", () => ({
  analyzeRepository: vi.fn(),
  resolveFixtureDir: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { GRAPH_INDEX: "graph-index" },
  enqueue: vi.fn(),
}));

vi.mock("@patchbay/git-provider", () => ({
  createGitHubAppProviderFromStore: vi.fn(),
}));

vi.mock("@patchbay/env", () => ({
  getSecretStore: vi.fn().mockReturnValue({}),
}));

vi.mock("../lib/audit", () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock("@patchbay/audit", () => ({
  AuditAction: {
    SCAN_STARTED: "scan.started",
    SCAN_COMPLETED: "scan.completed",
    SCAN_FAILED: "scan.failed",
    GRAPH_INDEX_QUEUED: "graph.index.queued",
  },
}));

vi.mock("@patchbay/domain", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/domain")>("@patchbay/domain");
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

import { analyzeRepository, resolveFixtureDir } from "@patchbay/repo-analysis";
import { createGitHubAppProviderFromStore } from "@patchbay/git-provider";
import { enqueue } from "@patchbay/queue";
import { createNotification } from "@patchbay/db";

const job = (data: unknown) => ({ data }) as Job;

function analysisResult(overrides: Record<string, unknown> = {}) {
  return {
    usages: [
      {
        packageName: "openai",
        filePath: "src/chat/chat-service.ts",
        symbol: "client.chat.completions.create",
        usageType: "METHOD_CALL",
        line: 12,
        column: 4,
        excerpt: "client.chat.completions.create({",
        riskTags: [],
      },
    ],
    lockfileVersions: { openai: "4.0.0" },
    manifests: [{ dependencies: { openai: "^3.0.0" }, devDependencies: {} }],
    commitSha: "snapshot-hash-1",
    filesScanned: 5,
    typescriptFiles: 4,
    packageCount: 2,
    packageManager: "pnpm",
    untrackedUsages: 0,
    durationMs: 100,
    ...overrides,
  };
}

function baseMocks(metadata: Record<string, unknown>, provider: string | null = "LOCAL") {
  vi.mocked(prisma.repository.findUnique).mockResolvedValue({
    id: "repo-1",
    organizationId: "org-1",
    provider,
    name: "acme/app",
    fullName: "acme/app",
    defaultBranch: "main",
    metadata,
  } as never);
  vi.mocked(prisma.repositoryScan.findUnique).mockResolvedValue({
    id: "scan-1",
    repositoryId: "repo-1",
  } as never);
  vi.mocked(prisma.repositoryScan.update).mockResolvedValue({} as never);
  vi.mocked(prisma.vendor.findMany).mockResolvedValue([
    { id: "v-openai", slug: "openai", enabled: true },
    { id: "v-stripe", slug: "stripe", enabled: true },
  ] as never);
  vi.mocked(prisma.integrationUsage.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.integrationUsage.deleteMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.integrationUsage.createMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.repositoryDependency.createMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.graphIndexJob.create).mockResolvedValue({ id: "job-1" } as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) =>
    (fn as (tx: unknown) => Promise<unknown>)(prisma)) as never);
}

describe("processScanRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveFixtureDir).mockReturnValue("C:/fixtures/openai-node-legacy");
  });

  it("scans a fixture repository and chains the graph-index job", async () => {
    baseMocks({ fixture: "openai-node-legacy", demo: true });
    vi.mocked(analyzeRepository).mockResolvedValue(analysisResult() as never);

    const result = await processScanRepository(
      job({ repositoryId: "repo-1", scanId: "scan-1", correlationId: "c-1" }),
    );

    expect(analyzeRepository).toHaveBeenCalledWith({
      rootDir: "C:/fixtures/openai-node-legacy",
      trackPackages: expect.arrayContaining(["openai", "stripe"]),
    });
    expect(prisma.integrationUsage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            filePath: "src/chat/chat-service.ts",
            vendorId: "v-openai",
            astLocation: { line: 12, column: 4 },
            metadata: { fixture: "openai-node-legacy" },
          }),
        ]),
      }),
    );
    expect(prisma.repositoryScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          commitSha: "snapshot-hash-1",
        }),
      }),
    );
    expect(prisma.graphIndexJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          repositoryId: "repo-1",
          mode: "BASELINE",
          status: "INDEXING",
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith("graph-index", {
      jobId: "job-1",
      repositoryId: "repo-1",
      correlationId: "c-1",
      mode: "BASELINE",
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        type: "scan.completed",
        title: "Scan completed: acme/app",
        correlationId: "c-1",
      }),
    );
    expect(result).toMatchObject({
      scanId: "scan-1",
      repositoryId: "repo-1",
      commitSha: "snapshot-hash-1",
      usageCount: 1,
    });
  });

  it("checks out a GitHub installation at the resolved HEAD sha and scans the workspace", async () => {
    baseMocks({ installationId: 42, externalId: "github:1", provider: "GITHUB" }, "GITHUB");
    const providerMock = {
      resolveHeadSha: vi.fn().mockResolvedValue("sha-abc"),
      checkout: vi.fn().mockResolvedValue({ workspaceDir: "C:/ws/github-checkout" }),
    };
    vi.mocked(createGitHubAppProviderFromStore).mockResolvedValue(providerMock as never);
    vi.mocked(analyzeRepository).mockResolvedValue(analysisResult() as never);

    const result = await processScanRepository(
      job({ repositoryId: "repo-1", scanId: "scan-1", correlationId: "c-1" }),
    );

    expect(createGitHubAppProviderFromStore).toHaveBeenCalledWith(
      { installationId: 42, repositoryFullName: "acme/app" },
      expect.anything(),
    );
    expect(providerMock.resolveHeadSha).toHaveBeenCalledWith("main");
    expect(providerMock.checkout).toHaveBeenCalledWith({
      sha: "sha-abc",
      baseBranch: "main",
      repositoryFullName: "acme/app",
    });
    expect(analyzeRepository).toHaveBeenCalledWith({
      rootDir: "C:/ws/github-checkout",
      trackPackages: expect.anything(),
    });
    expect(prisma.integrationUsage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            metadata: { installationId: 42 },
            astLocation: { line: 12, column: 4 },
          }),
        ]),
      }),
    );
    expect(prisma.repositoryScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          commitSha: "sha-abc",
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      "graph-index",
      expect.objectContaining({ mode: "BASELINE" }),
    );
    expect(result.commitSha).toBe("sha-abc");
  });

  it("fails honestly when a GITHUB repository has no installation", async () => {
    baseMocks({ provider: "GITHUB" }, "GITHUB");

    await expect(
      processScanRepository(
        job({ repositoryId: "repo-1", scanId: "scan-1", correlationId: "c-1" }),
      ),
    ).rejects.toThrow(/has no fixture metadata and is not a GitHub installation/);

    expect(prisma.repositoryScan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error: expect.stringMatching(/no fixture metadata/),
        }),
      }),
    );
    expect(prisma.integrationUsage.createMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        type: "scan.failed",
        title: "Scan failed: acme/app",
        correlationId: "c-1",
      }),
    );
  });
});
