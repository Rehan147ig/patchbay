import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processRunValidation, type RunValidationJobData } from "./run-validation";
import { prisma } from "@patchbay/db";
import { isAllowedCommand, resolveSandboxValidationMode } from "@patchbay/sandbox-runner";
import { recordValidationArtifact, resolveValidationProfile } from "../lib/validation-profiles";
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
    remediationAttempt: {
      create: vi.fn(),
    },
    $transaction: vi.fn((actions) => Promise.all(actions)),
  },
}));

const mockRun = vi.fn();
const fixtureDir = mkdtempSync(path.join(tmpdir(), "patchbay-worker-fixture-"));
writeFileSync(
  path.join(fixtureDir, "package.json"),
  JSON.stringify({ name: "worker-fixture", scripts: {} }),
);
afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

vi.mock("@patchbay/sandbox-runner", () => ({
  isAllowedCommand: vi.fn(),
  resolveSandboxValidationMode: vi.fn(() => "hosted-docker"),
  createSandboxRunner: vi.fn(() => ({
    runtime: "process",
    isAvailable: async () => true,
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

vi.mock("../lib/validation-profiles", () => ({
  resolveValidationProfile: vi.fn(),
  recordValidationArtifact: vi.fn(),
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
      remediationPlanId: "plan-1",
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
      remediationPlanId: "plan-1",
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
    vi.mocked(resolveFixtureDir).mockReturnValue(fixtureDir);
    vi.mocked(isAllowedCommand).mockReturnValue(false);

    await expect(processRunValidation(mockJob)).rejects.toThrow(
      "command not on the validation allowlist: rm -rf /",
    );
  });

  it("executes validation commands and updates status to PASSED when all commands succeed", async () => {
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce({
      id: "val-1",
      remediationPlanId: "plan-1",
      commands: ["pnpm install --frozen-lockfile"],
    } as never);
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce({
      id: "plan-1",
      strategy: "deterministic-ast",
      remediationCaseId: "case-1",
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
    vi.mocked(resolveFixtureDir).mockReturnValue(fixtureDir);
    vi.mocked(isAllowedCommand).mockReturnValue(true);
    mockRun.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      durationMs: 120,
      output: "Done in 0.12s",
      timedOut: false,
      stdout: "Done in 0.12s",
      stderr: "",
      fullStdout: "Done in 0.12s",
      fullStderr: "",
      provenance: {
        runtime: "container",
        mode: "test",
        imageDigest: "sha256:abc123",
        networkPolicy: "none",
        limits: { cpus: "0.5", memory: "512m", pidsLimit: 128, timeoutMs: 120_000 },
        workspace: { path: "/tmp/ws-1", disposable: true },
        failureClass: "none",
      },
    });

    const result = await processRunValidation(mockJob);

    expect(result.status).toBe("PASSED");
    expect(result.commandsRun).toBe(1);
    expect(prisma.validationRun.update).toHaveBeenCalledWith({
      where: { id: "val-1" },
      data: expect.objectContaining({
        status: "PASSED",
        exitCode: 0,
        runtimeMetadata: {
          runtime: "container",
          mode: "test",
          imageDigest: "sha256:abc123",
          networkPolicy: "none",
          limits: { cpus: "0.5", memory: "512m", pidsLimit: 128, timeoutMs: 120_000 },
          workspace: { path: "/tmp/ws-1", disposable: true },
          failureClass: "none",
        },
      }),
    });
    expect(prisma.remediationPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { status: "VALIDATED" },
    });
    expect(prisma.remediationAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          caseId: "case-1",
          strategyId: "deterministic-ast",
          status: "SUCCEEDED",
          organizationId: "org-1",
        }),
      }),
    );
    // Legacy run (no profile): artifact recorded with a null profile.
    expect(resolveValidationProfile).not.toHaveBeenCalled();
    expect(recordValidationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        validationRunId: "val-1",
        organizationId: "org-1",
        validationProfileId: null,
        commandsExecuted: ["pnpm install --frozen-lockfile"],
        exitCodes: [0],
        imageDigest: "sha256:abc123",
      }),
    );
  });

  it("records SKIPPED and never spawns a runner in github-checks-only mode", async () => {
    vi.mocked(resolveSandboxValidationMode).mockReturnValue("github-checks-only");
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce({
      id: "val-1",
      remediationPlanId: "plan-1",
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
      patches: [],
    } as never);
    vi.mocked(prisma.vendorChangeEvent.findUnique).mockResolvedValueOnce({
      id: "change-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(isAllowedCommand).mockReturnValue(true);

    const result = await processRunValidation(mockJob);

    expect(result.status).toBe("SKIPPED");
    expect(result.commandsRun).toBe(0);
    expect(prisma.validationRun.update).toHaveBeenCalledWith({
      where: { id: "val-1" },
      data: expect.objectContaining({
        status: "SKIPPED",
        stdout: expect.stringContaining("github-checks-only"),
      }),
    });
    expect(prisma.remediationPlan.update).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    // SKIPPED attests nothing: no profile resolution, no artifact.
    expect(resolveValidationProfile).not.toHaveBeenCalled();
    expect(recordValidationArtifact).not.toHaveBeenCalled();
  });
});

describe("processRunValidation (WP8 execution plane)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
    // The SKIPPED test above leaves the mode mock pinned to
    // github-checks-only (clearAllMocks keeps implementations); restore the
    // hosted path explicitly for the execution-plane tests.
    vi.mocked(resolveSandboxValidationMode).mockReturnValue("hosted-docker");
  });

  const validJobData: RunValidationJobData = {
    validationRunId: "val-1",
    remediationPlanId: "plan-1",
    organizationId: "org-1",
    correlationId: "corr-1",
  };
  const mockJob = { data: validJobData } as Job;

  const resolvedProfile = {
    profileId: "prof-1",
    profileName: "default",
    profileVersion: 1,
    commands: ["pnpm install --frozen-lockfile"],
    image: "node:20-slim",
    expectedDigest: "sha256:pinned",
    timeoutMs: 60_000,
    memoryLimit: "1g",
    networkPolicy: "none",
  };

  function profilePlan() {
    return {
      id: "plan-1",
      strategy: "deterministic-ast",
      remediationCaseId: "case-1",
      impactAssessment: {
        changeEventId: "change-1",
        repository: {
          id: "repo-1",
          metadata: { fixture: "openai-node-legacy" },
          organizationId: "org-1",
        },
      },
      patches: [{ filePath: "src/chat.ts", patchedContent: "console.log('patched');" }],
    } as never;
  }

  function profileRun() {
    return {
      id: "val-1",
      remediationPlanId: "plan-1",
      commands: ["pnpm install --frozen-lockfile"],
      validationProfileId: "prof-1",
    } as never;
  }

  it("executes profile commands with profile bounds and attests the run", async () => {
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce(profileRun());
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce(profilePlan());
    vi.mocked(prisma.vendorChangeEvent.findUnique).mockResolvedValueOnce({
      id: "change-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(resolveFixtureDir).mockReturnValue(fixtureDir);
    vi.mocked(isAllowedCommand).mockReturnValue(true);
    vi.mocked(resolveValidationProfile).mockResolvedValueOnce(resolvedProfile as never);
    vi.mocked(recordValidationArtifact).mockResolvedValueOnce({
      artifactId: "art-1",
      artifactHash: "hash-1",
    });
    mockRun.mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      durationMs: 90,
      output: "ok",
      timedOut: false,
      stdout: "ok",
      stderr: "",
      fullStdout: "ok-full",
      fullStderr: "",
      provenance: {
        runtime: "container",
        mode: "test",
        imageDigest: "sha256:pinned",
        networkPolicy: "none",
        limits: { cpus: "0.5", memory: "1g", pidsLimit: 128, timeoutMs: 60_000 },
        workspace: { path: "/tmp/ws-1", disposable: true },
        failureClass: "none",
      },
    });

    const result = await processRunValidation(mockJob);

    expect(result.status).toBe("PASSED");
    expect(resolveValidationProfile).toHaveBeenCalledWith("prof-1", "org-1");
    // Profile bounds reach the runner verbatim — including the digest pin.
    expect(mockRun).toHaveBeenCalledWith("pnpm install --frozen-lockfile", expect.any(String), {
      timeoutMs: 60_000,
      networkPolicy: "none",
      image: "node:20-slim",
      expectedDigest: "sha256:pinned",
      memory: "1g",
    });
    expect(recordValidationArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        validationRunId: "val-1",
        validationProfileId: "prof-1",
        commandsExecuted: ["pnpm install --frozen-lockfile"],
        exitCodes: [0],
        image: "node:20-slim",
        imageDigest: "sha256:pinned",
        fullStdout: expect.stringContaining("ok-full"),
      }),
    );
  });

  it("fails loudly (no fallback, no artifact) when profile resolution fails", async () => {
    vi.mocked(prisma.validationRun.findUnique).mockResolvedValueOnce(profileRun());
    vi.mocked(prisma.remediationPlan.findUnique).mockResolvedValueOnce(profilePlan());
    vi.mocked(prisma.vendorChangeEvent.findUnique).mockResolvedValueOnce({
      id: "change-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(resolveFixtureDir).mockReturnValue(fixtureDir);
    vi.mocked(resolveValidationProfile).mockRejectedValueOnce(
      new Error("validation profile prof-1 fails server policy"),
    );

    await expect(processRunValidation(mockJob)).rejects.toThrow(
      "validation profile prof-1 fails server policy",
    );
    expect(mockRun).not.toHaveBeenCalled();
    expect(recordValidationArtifact).not.toHaveBeenCalled();
    expect(prisma.validationRun.update).toHaveBeenCalledWith({
      where: { id: "val-1" },
      data: expect.objectContaining({ status: "FAILED", exitCode: -1 }),
    });
  });
});
