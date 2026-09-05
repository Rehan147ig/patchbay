import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  contractDedupeKey,
  orchestrateContractChange,
  recordRemediationAttempt,
} from "./case-orchestration";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    contractChange: { findUnique: vi.fn() },
    contractConsumer: { findMany: vi.fn() },
    graphSnapshot: { findFirst: vi.fn() },
    remediationCase: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    remediationCaseEvent: { create: vi.fn() },
    impactAssessment: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    remediationAttempt: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    notification: { create: vi.fn() },
  },
  createNotification: vi.fn(),
  NotificationType: { CASE_CREATED: "CASE_CREATED" },
}));

import { createNotification } from "@patchbay/db";

const CHANGE = {
  id: "chg-1",
  sourceId: "src-1",
  identity: "version:4.8.0->4.8.1",
  severity: "HIGH",
  description: "bump",
  source: { id: "src-1", vendorSlug: "openai", organizationId: null },
};

const CONSUMERS = [
  {
    repositoryId: "repo-1",
    identifier: "openai",
    versionRange: "4.8.1",
    confidence: 95,
    evidenceJson: { commitSha: "sha-1" },
  },
  {
    repositoryId: "repo-2",
    identifier: "openai",
    versionRange: "4.8.1",
    confidence: 80,
    evidenceJson: { commitSha: "sha-2" },
  },
];

describe("contractDedupeKey", () => {
  it("is stable and scoped to org, source, identity, and repo", () => {
    const key = contractDedupeKey("org-1", "src-1", "id-1", "repo-1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(contractDedupeKey("org-1", "src-1", "id-1", "repo-1")).toBe(key);
    expect(contractDedupeKey("org-2", "src-1", "id-1", "repo-1")).not.toBe(key);
    expect(contractDedupeKey("org-1", "src-1", "id-1", "repo-2")).not.toBe(key);
  });
});

// File-scope setup: every mock is fresh for every test in both describes.
// mockResolvedValueOnce queues always win over the default implementations.
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.contractChange.findUnique).mockResolvedValue(CHANGE as never);
  vi.mocked(prisma.contractConsumer.findMany).mockImplementation((async (args: unknown) => {
    const where = (args as { where?: { repositoryId?: string } }).where;
    if (!where?.repositoryId) return CONSUMERS;
    return CONSUMERS.filter((consumer) => consumer.repositoryId === where.repositoryId);
  }) as never);
  vi.mocked(prisma.graphSnapshot.findFirst).mockResolvedValue({ id: "snap-1" } as never);
  // Default lookup pattern: each reconcile misses (fresh case), each advance
  // sees the just-created OBSERVED row. Reconcile and advance alternate
  // strictly in sequence (the loop awaits each repo fully), so odd calls miss
  // and even calls hit. Tests needing other shapes override explicitly.
  let findUniqueCalls = 0;
  vi.mocked(prisma.remediationCase.findUnique).mockImplementation((async () => {
    findUniqueCalls += 1;
    if (findUniqueCalls % 2 === 1) return null;
    return { id: "case-1", status: "OBSERVED" };
  }) as never);
  vi.mocked(prisma.remediationCase.create).mockImplementation((async (args: unknown) => ({
    id: "case-1",
    ...(args as { data: Record<string, unknown> }).data,
  })) as never);
  vi.mocked(prisma.remediationCase.update).mockImplementation((async (args: unknown) => ({
    id: "case-1",
    status: "IMPACT_CONFIRMED",
    ...(args as { data: Record<string, unknown> }).data,
  })) as never);
  vi.mocked(prisma.impactAssessment.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.impactAssessment.create).mockResolvedValue({ id: "assess-1" } as never);
  vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
  vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  vi.mocked(createNotification).mockResolvedValue({} as never);
  vi.mocked(prisma.remediationAttempt.create).mockResolvedValue({ id: "att-1" } as never);
});

describe("orchestrateContractChange", () => {
  it("creates one case per consumer repository with assessments and OBSERVED→IMPACT_CONFIRMED timeline", async () => {
    const result = await orchestrateContractChange({
      contractChangeId: "chg-1",
      organizationId: "org-1",
      correlationId: "corr-1",
    });
    expect(result).toMatchObject({ affected: true, consumerCount: 2 });
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0]).toMatchObject({
      caseId: "case-1",
      repositoryId: "repo-1",
      created: true,
    });

    const created = vi.mocked(prisma.remediationCase.create).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(created.data).toMatchObject({
      organizationId: "org-1",
      status: "OBSERVED",
      reasonCode: "contract-change",
      triggerType: "CONTRACT_CHANGE",
      contractChangeId: "chg-1",
      capabilityLevel: "ASSESS",
    });
    expect(created.data.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(created.data.scopeKey).toContain("contract:src-1:repo-1");

    expect(prisma.impactAssessment.create).toHaveBeenCalledTimes(2);
    const assessment = vi.mocked(prisma.impactAssessment.create).mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(assessment.data).toMatchObject({
      caseId: "case-1",
      affected: true,
      confidence: 95,
      reasonCode: "contract-change",
      status: "AFFECTED",
      graphSnapshotId: "snap-1",
    });
    // OBSERVED creation + IMPACT_CONFIRMED advance = timeline + audit each.
    expect(prisma.remediationCaseEvent.create).toHaveBeenCalledTimes(4);
    expect(createNotification).toHaveBeenCalledTimes(2);
  });

  it("creates no case when no consumers carry evidence (evidence-gated)", async () => {
    vi.mocked(prisma.contractConsumer.findMany).mockResolvedValue([]);
    const result = await orchestrateContractChange({
      contractChangeId: "chg-1",
      organizationId: "org-1",
      correlationId: "corr-1",
    });
    expect(result).toEqual({ affected: false, consumerCount: 0, cases: [] });
    expect(prisma.remediationCase.create).not.toHaveBeenCalled();
  });

  it("rejects unknown changes and foreign-organization sources", async () => {
    vi.mocked(prisma.contractChange.findUnique).mockResolvedValue(null);
    await expect(
      orchestrateContractChange({
        contractChangeId: "nope",
        organizationId: "org-1",
        correlationId: "c",
      }),
    ).rejects.toThrow(/not found/);

    vi.mocked(prisma.contractChange.findUnique).mockResolvedValue({
      ...CHANGE,
      source: { ...CHANGE.source, organizationId: "org-other" },
    } as never);
    await expect(
      orchestrateContractChange({
        contractChangeId: "chg-1",
        organizationId: "org-1",
        correlationId: "c",
      }),
    ).rejects.toThrow(/another organization/);
    expect(prisma.remediationCase.create).not.toHaveBeenCalled();
  });

  it("converges duplicates onto the existing case without new rows or timeline spam", async () => {
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue({
      id: "case-1",
      status: "IMPACT_CONFIRMED",
    } as never);
    vi.mocked(prisma.remediationCase.update).mockImplementation((async (args: unknown) => ({
      id: "case-1",
      status: "IMPACT_CONFIRMED",
      ...(args as { data: Record<string, unknown> }).data,
    })) as never);
    const result = await orchestrateContractChange({
      contractChangeId: "chg-1",
      organizationId: "org-1",
      correlationId: "corr-2",
    });
    expect(result.cases).toHaveLength(2);
    expect(result.cases[0]).toMatchObject({ caseId: "case-1", created: false });
    expect(prisma.remediationCase.create).not.toHaveBeenCalled();
    expect(prisma.remediationCaseEvent.create).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("never reopens terminal cases", async () => {
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue({
      id: "case-9",
      status: "MERGED",
    } as never);
    const result = await orchestrateContractChange({
      contractChangeId: "chg-1",
      organizationId: "org-1",
      correlationId: "corr-3",
    });
    expect(result.cases[0]).toMatchObject({ caseId: "case-9", created: false, status: "MERGED" });
    expect(prisma.remediationCase.update).not.toHaveBeenCalled();
  });

  it("narrows reconciliation to a single repository when requested", async () => {
    const result = await orchestrateContractChange({
      contractChangeId: "chg-1",
      organizationId: "org-1",
      repositoryId: "repo-2",
      correlationId: "corr-1",
    });
    expect(result.cases).toHaveLength(1);
    expect(result.cases[0]?.repositoryId).toBe("repo-2");
    expect(prisma.contractConsumer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ repositoryId: "repo-2" }) }),
    );
  });
});

describe("recordRemediationAttempt", () => {
  const attempt = {
    caseId: "case-1",
    strategyId: "validation:hosted-docker",
    inputHash: "ab".repeat(32),
    status: "SUCCEEDED" as const,
    organizationId: "org-1",
    correlationId: "corr-1",
  };

  it("records attempts with full provenance", async () => {
    vi.mocked(prisma.remediationAttempt.create).mockResolvedValue({ id: "att-1" } as never);
    const result = await recordRemediationAttempt(attempt);
    expect(result).toEqual({ attemptId: "att-1" });
    expect(prisma.remediationAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caseId: "case-1",
          strategyId: "validation:hosted-docker",
          status: "SUCCEEDED",
        }),
      }),
    );
  });

  it("skips legacy plans without a linked case instead of inventing linkage", async () => {
    const result = await recordRemediationAttempt({ ...attempt, caseId: null });
    expect(result).toBeNull();
    expect(prisma.remediationAttempt.create).not.toHaveBeenCalled();
  });

  it("never throws when the database write fails (remediation continues)", async () => {
    vi.mocked(prisma.remediationAttempt.create).mockRejectedValue(new Error("db down"));
    await expect(recordRemediationAttempt(attempt)).resolves.toBeNull();
  });
});
