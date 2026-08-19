import { describe, expect, it, vi, beforeEach } from "vitest";
import { processCreatePR, type CreatePRJobData } from "./create-pr";
import { prisma, createNotification, agentVerdictFromRun } from "@patchbay/db";
import { createGitProviderFromEnv } from "@patchbay/git-provider";
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
    agentRun: {
      findFirst: vi.fn(),
    },
    remediationCase: {
      update: vi.fn(),
    },
    remediationCaseEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
    auditEvent: {
      create: vi.fn(),
    },
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
  agentBodySection: vi.fn((verdict: { reviewSummary?: string }) => {
    const lines = ["", "## Agent review"];
    lines.push(`- Agent summary for ${verdict.reviewSummary ?? "the run"}`);
    return lines.join("\n");
  }),
  agentVerdictFromRun: vi.fn(),
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
        repository: {
          id: "repo-1",
          name: "app",
          metadata: { fixture: "openai" },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
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
        repository: {
          id: "repo-1",
          name: "app",
          metadata: { fixture: "openai" },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
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
        repository: {
          id: "repo-1",
          name: "app",
          metadata: { fixture: "openai" },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
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
    // Local fixture repository: provider factory falls back without a target.
    expect(createGitProviderFromEnv).toHaveBeenCalledWith();
  });

  it("passes the GitHub App installation target when the repository is a GitHub installation", async () => {
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
        repository: {
          id: "repo-1",
          name: "app",
          fullName: "acme/app",
          defaultBranch: "main",
          provider: "GITHUB",
          metadata: { installationId: 42 },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
      },
    } as never);
    providerMock.createDraftPullRequest.mockResolvedValueOnce({
      provider: "GITHUB",
      branchName: "patchbay/remediation-plan-1",
      url: "https://github.com/acme/app/pull/42",
      externalId: "42",
      title: "[Patchbay] Test Change",
      body: "body",
      status: "DRAFT",
    });
    vi.mocked(prisma.pullRequest.create).mockResolvedValueOnce({
      id: "pr-1",
      url: "https://github.com/acme/app/pull/42",
      branchName: "patchbay/remediation-plan-1",
    } as never);

    const result = await processCreatePR(mockJob);

    expect(result.pullRequestId).toBe("pr-1");
    expect(createGitProviderFromEnv).toHaveBeenCalledWith({
      installationId: 42,
      repositoryFullName: "acme/app",
      baseBranch: "main",
    });
    expect(providerMock.createDraftPullRequest).toHaveBeenCalledTimes(1);
  });

  it("falls back to the local provider when the repository is GITHUB but has no installation", async () => {
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
        repository: {
          id: "repo-1",
          name: "app",
          provider: "GITHUB",
          metadata: { fixture: "openai-node-legacy" },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
      },
    } as never);
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

    await processCreatePR(mockJob);

    // No installation target is passed, so createGitProviderFromEnv selects
    // PAT or LocalGitProvider, never the GitHub App.
    expect(createGitProviderFromEnv).toHaveBeenCalledWith();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        type: "pull_request.created",
        correlationId: "corr-1",
      }),
    );
  });

  it("includes the agent review section when a SUCCEEDED run exists", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      remediationCaseId: "case-1",
      confidence: 90,
      patches: [{ filePath: "src/app.ts", patchedContent: "code" }],
      validations: [{ status: "PASSED" }],
      approvals: [],
      pullRequests: [],
      impactAssessment: {
        score: 50,
        rationale: "test",
        affectedUsages: [],
        repository: {
          id: "repo-1",
          name: "app",
          metadata: { fixture: "openai" },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
      },
    } as never);
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValueOnce({
      outputJson: { plan: {}, review: {} },
    } as never);
    vi.mocked(agentVerdictFromRun).mockReturnValueOnce({
      editCount: 5,
      approved: true,
      confidence: 87,
      reviewSummary: "Safe migration",
    });
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

    await processCreatePR(mockJob);

    expect(prisma.agentRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", remediationCaseId: "case-1", status: "SUCCEEDED" },
        orderBy: { createdAt: "desc" },
      }),
    );
    const body = providerMock.createDraftPullRequest.mock.calls[0]?.[0].body as string;
    expect(body).toContain("## Agent review");
    expect(body).toContain("Safe migration");
  });

  it("omits the agent review section when no SUCCEEDED run exists", async () => {
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      remediationCaseId: "case-1",
      confidence: 90,
      patches: [{ filePath: "src/app.ts", patchedContent: "code" }],
      validations: [{ status: "PASSED" }],
      approvals: [],
      pullRequests: [],
      impactAssessment: {
        score: 50,
        rationale: "test",
        affectedUsages: [],
        repository: {
          id: "repo-1",
          name: "app",
          metadata: { fixture: "openai" },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
      },
    } as never);
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValueOnce(null as never);
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

    await processCreatePR(mockJob);

    expect(agentVerdictFromRun).not.toHaveBeenCalled();
    const body = providerMock.createDraftPullRequest.mock.calls[0]?.[0].body as string;
    expect(body).not.toContain("Agent review");
  });

  it("audits PR_FAILED without leaking credential material from provider errors", async () => {
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
        repository: {
          id: "repo-1",
          name: "app",
          fullName: "acme/app",
          defaultBranch: "main",
          provider: "GITHUB",
          metadata: { installationId: 42 },
          organizationId: "org-1",
        },
        changeEvent: { title: "Test Change", organizationId: "org-1" },
      },
    } as never);
    providerMock.createDraftPullRequest.mockRejectedValueOnce(
      new Error(
        "GitHub API POST /repos/acme/app/pulls failed: 401 ghs_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      ),
    );

    await expect(processCreatePR(mockJob)).rejects.toThrow(/failed: 401/);

    const auditCall = vi.mocked(prisma.auditEvent.create).mock.calls[0]?.[0] as {
      data: { afterJson: unknown };
    };
    const afterJson = JSON.stringify(auditCall.data.afterJson);
    expect(afterJson).not.toContain("ghs_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
    expect(afterJson).toContain("[REDACTED]");
  });
});
