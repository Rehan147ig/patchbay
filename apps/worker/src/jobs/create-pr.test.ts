import { describe, expect, it, vi, beforeEach } from "vitest";
import { processCreatePR, type CreatePRJobData } from "./create-pr";
import { prisma } from "@patchbay/db";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import type { Job } from "bullmq";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationPlan: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pullRequest: {
      create: vi.fn(),
    },
  },
}));

const providerMock = vi.hoisted(() => ({
  createDraftPullRequest: vi.fn(),
}));

vi.mock("@patchbay/git-provider", () => ({
  createGitProviderFromEnv: vi.fn(() => providerMock),
}));

vi.mock("@patchbay/repo-analysis", () => ({
  resolveFixtureDir: vi.fn(),
}));

vi.mock("../lib/audit", () => ({
  writeAuditEvent: vi.fn(),
}));

describe("processCreatePR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validJobData: CreatePRJobData = {
    remediationPlanId: "plan-1",
    organizationId: "org-1",
    correlationId: "corr-1",
  };

  const mockJob = { data: validJobData } as Job;

  it("throws error if remediation plan is not found", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce(null);
    await expect(processCreatePR(mockJob)).rejects.toThrow("remediation plan not found: plan-1");
  });

  it("returns existing PR idempotently if pull request already created", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      pullRequests: [
        { id: "pr-existing", url: "file:///tmp/existing", branchName: "patchbay/existing" },
      ],
      impactAssessment: {
        score: 50,
        rationale: "test",
        affectedUsages: [],
        repository: { id: "repo-1", name: "app", metadata: { fixture: "openai" } },
        changeEvent: { title: "Test Change" },
      },
    } as never);

    const result = await processCreatePR(mockJob);

    expect(result.pullRequestId).toBe("pr-existing");
    expect(result.url).toBe("file:///tmp/existing");
    expect(providerMock.createDraftPullRequest).not.toHaveBeenCalled();
  });

  it("throws error if policy blocks PR creation (e.g. no validation)", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      confidence: 90,
      patches: [{ filePath: "src/app.ts", patchedContent: "code" }],
      validations: [], // No passing validation!
      approvals: [],
      pullRequests: [],
      impactAssessment: {
        score: 50,
        rationale: "test",
        affectedUsages: [],
        repository: { id: "repo-1", name: "app", metadata: { fixture: "openai" } },
        changeEvent: { title: "Test Change" },
      },
    } as never);

    await expect(processCreatePR(mockJob)).rejects.toThrow(
      "PR creation blocked by policy decision",
    );
  });

  it("creates draft PR when policy allows", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      confidence: 90,
      patches: [{ filePath: "src/app.ts", patchedContent: "code" }],
      validations: [{ status: "PASSED" }],
      approvals: [],
      pullRequests: [],
      impactAssessment: {
        score: 50,
        rationale: "test",
        affectedUsages: [],
        repository: { id: "repo-1", name: "app", metadata: { fixture: "openai" } },
        changeEvent: { title: "Test Change" },
      },
    } as never);
    vi.mocked(resolveFixtureDir).mockReturnValue(process.cwd());
    providerMock.createDraftPullRequest.mockResolvedValueOnce({
      provider: "LOCAL",
      branchName: "patchbay/remediation-plan-1",
      url: "file:///tmp/pr",
      title: "[Patchbay] Test Change",
      body: "body",
      status: "DRAFT",
    });
    vi.mocked(prisma.pullRequest.create).mockResolvedValueOnce({
      id: "pr-1",
      url: "file:///tmp/pr",
      branchName: "patchbay/remediation-plan-1",
    } as never);

    const result = await processCreatePR(mockJob);

    expect(result.pullRequestId).toBe("pr-1");
    expect(result.url).toBe("file:///tmp/pr");
    expect(prisma.remediationPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { status: "PR_CREATED" },
    });
  });
});
