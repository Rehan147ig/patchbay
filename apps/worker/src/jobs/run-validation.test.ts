import { describe, expect, it, vi, beforeEach } from "vitest";
import { processRunValidation, type RunValidationJobData } from "./run-validation";
import { prisma } from "@patchbay/db";
import { isAllowedCommand } from "@patchbay/sandbox-runner";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import type { Job } from "bullmq";

vi.mock("@patchbay/db", () => ({
  prisma: {
    validationRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    remediationPlan: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    vendorChangeEvent: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((actions) => Promise.all(actions)),
  },
}));

const mockRun = vi.fn();

vi.mock("@patchbay/sandbox-runner", () => ({
  isAllowedCommand: vi.fn(),
  createSandboxRunner: vi.fn(() => ({
    runtime: "process",
    isAvailable: () => true,
    getAllowlist: () => [],
    run: mockRun,
  })),
}));

vi.mock("@patchbay/repo-analysis", () => ({
  resolveFixtureDir: vi.fn(),
}));

vi.mock("../lib/audit", () => ({
  writeAuditEvent: vi.fn(),
}));

describe("processRunValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
  });

  const validJobData: RunValidationJobData = {
    validationRunId: "val-1",
    remediationPlanId: "plan-1",
    organizationId: "org-1",
    correlationId: "corr-1",
  };

  const mockJob = {
    data: validJobData,
  } as Job;

  it("throws error if job data is invalid", async () => {
    const invalidJob = { data: {} } as Job;
    await expect(processRunValidation(invalidJob)).rejects.toThrow(
      "invalid run-validation job data",
    );
  });

  it("throws error if validation run is not found", async () => {
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce(null);
    await expect(processRunValidation(mockJob)).rejects.toThrow("validation run not found: val-1");
  });

  it("throws error if remediation plan is not found", async () => {
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce({
      id: "val-1",
      commands: ["pnpm install --frozen-lockfile"],
    } as never);
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce(null);

    await expect(processRunValidation(mockJob)).rejects.toThrow(
      "remediation plan not found: plan-1",
    );
  });

  it("throws error if command is not on the allowlist", async () => {
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce({
      id: "val-1",
      commands: ["rm -rf /"],
    } as never);
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      impactAssessment: {
        changeEventId: "change-1",
        repository: {
          id: "repo-1",
          metadata: { fixture: "openai-node-legacy" },
          organizationId: "org-1",
        },
      },
      patches: [],
    } as never);
    vi.mocked(prisma.vendorChangeEvent.findUnique).mockResolvedValueOnce({
      id: "change-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(resolveFixtureDir).mockReturnValue(process.cwd());
    vi.mocked(isAllowedCommand).mockReturnValue(false);

    await expect(processRunValidation(mockJob)).rejects.toThrow(
      "command not on the validation allowlist: rm -rf /",
    );
  });

  it("executes validation commands and updates status to PASSED when all commands succeed", async () => {
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce({
      id: "val-1",
      commands: ["pnpm install --frozen-lockfile"],
    } as never);
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      impactAssessment: {
        changeEventId: "change-1",
        repository: {
          id: "repo-1",
          metadata: { fixture: "openai-node-legacy" },
          organizationId: "org-1",
        },
      },
      patches: [
        {
          filePath: "src/chat.ts",
          patchedContent: "console.log('patched');",
        },
      ],
    } as never);
    vi.mocked(prisma.vendorChangeEvent.findUnique).mockResolvedValueOnce({
      id: "change-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(resolveFixtureDir).mockReturnValue(process.cwd());
    vi.mocked(isAllowedCommand).mockReturnValue(true);
    mockRun.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      durationMs: 120,
      output: "Done in 0.12s",
      timedOut: false,
      stdout: "Done in 0.12s",
      stderr: "",
    });

    const result = await processRunValidation(mockJob);

    expect(result.status).toBe("PASSED");
    expect(result.commandsRun).toBe(1);
    expect(prisma.validationRun.update).toHaveBeenCalledWith({
      where: { id: "val-1" },
      data: expect.objectContaining({ status: "PASSED", exitCode: 0 }),
    });
    expect(prisma.remediationPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { status: "VALIDATED" },
    });
  });
});
