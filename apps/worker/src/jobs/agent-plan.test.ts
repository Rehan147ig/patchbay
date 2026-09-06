import { beforeEach, describe, expect, it, vi } from "vitest";
import { processAgentPlan } from "./agent-plan";
import { packageImpact, prisma } from "@patchbay/db";
import type { Job } from "bullmq";

vi.mock("@patchbay/db", () => ({
  prisma: {
    agentRun: { findUnique: vi.fn(), update: vi.fn() },
    agentStep: { create: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
    remediationCase: { findUnique: vi.fn(), update: vi.fn() },
    remediationCaseEvent: { create: vi.fn() },
    remediationAttempt: { create: vi.fn() },
    $transaction: vi.fn((actions: Array<Promise<unknown>>) => Promise.all(actions)),
  },
  packageImpact: vi.fn(),
}));

vi.mock("../lib/audit", () => ({
  writeAuditEvent: vi.fn(),
}));

vi.mock("@patchbay/repo-analysis", () => ({
  resolveFixtureDir: (name: string) => `fixtures/${name}`,
}));

function agentRunRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    organizationId: "org-1",
    releaseRecordId: "rel-1",
    repositoryId: "repo-1",
    releaseRepositoryMatchId: "match-1",
    remediationCaseId: "case-1",
    status: "QUEUED",
    repository: { metadata: {} },
    match: {
      dependency: { commitSha: "abc123", resolvedVersion: "4.0.0", declaredRange: "^4.0.0" },
    },
    releaseRecord: {
      version: "4.0.0",
      product: { packageName: "openai", vendor: { slug: "openai" } },
      classifications: [],
    },
    inputJson: null,
    outputJson: null,
    budgetCents: null,
    model: null,
    provider: null,
    startedAt: null,
    ...overrides,
  };
}

describe("processAgentPlan attempt provenance (WP7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.agentRun.findUnique).mockResolvedValue(agentRunRecord() as never);
    vi.mocked(prisma.agentRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.agentStep.create).mockResolvedValue({ id: "step-1" } as never);
    vi.mocked(prisma.agentStep.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.remediationAttempt.create).mockResolvedValue({ id: "att-1" } as never);
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue({
      id: "case-1",
      status: "PLANNING",
      reasonCode: "usage-evidence",
    } as never);
    vi.mocked(prisma.remediationCase.update).mockResolvedValue({} as never);
    vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
    vi.mocked(packageImpact).mockResolvedValue({
      packageName: "openai",
      clientCount: 1,
      apiOperationCount: 1,
      modules: [{ filePath: "src/chat.ts", edgeKinds: ["INVOKES_API"], evidenceCount: 1 }],
      resolvedVersion: "4.0.0",
      declaredRanges: "^4.0.0",
      snapshotId: "snap-1",
    });
  });

  const job = { data: { agentRunId: "run-1", correlationId: "corr-1" } } as Job;

  it("records a SUCCEEDED attempt with pack version on a clean run and advances an edit-less case to PLAN_ONLY", async () => {
    await processAgentPlan(job);
    expect(prisma.remediationAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caseId: "case-1",
          strategyId: "agent-plan",
          rulePackVersion: "1.0.0",
          agentRunId: "run-1",
          status: "SUCCEEDED",
          organizationId: "org-1",
        }),
      }),
    );
    const inputHash = (
      vi.mocked(prisma.remediationAttempt.create).mock.calls[0]?.[0] as {
        data: { inputHash: string };
      }
    ).data.inputHash;
    expect(inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.remediationCase.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PLAN_ONLY" }) }),
    );
    expect(prisma.remediationCaseEvent.create).toHaveBeenCalledTimes(1);
  });

  it("records a FAILED attempt and leaves the case retryable at PLANNING on tool failure", async () => {
    vi.mocked(packageImpact).mockRejectedValue(new Error("graph down"));
    await expect(processAgentPlan(job)).rejects.toThrow();
    expect(prisma.remediationAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caseId: "case-1",
          strategyId: "agent-plan",
          status: "FAILED",
          failureCode: expect.stringContaining("graph down"),
        }),
      }),
    );
    // Case stays PLANNING (retryable) with a timeline entry; never advanced.
    expect(prisma.remediationCase.update).not.toHaveBeenCalled();
    expect(prisma.remediationCaseEvent.create).toHaveBeenCalledTimes(1);
  });

  it("skips attempt recording honestly when the run has no linked case", async () => {
    vi.mocked(prisma.agentRun.findUnique).mockResolvedValue(
      agentRunRecord({ remediationCaseId: null }) as never,
    );
    await processAgentPlan(job);
    expect(prisma.remediationAttempt.create).not.toHaveBeenCalled();
  });
});
