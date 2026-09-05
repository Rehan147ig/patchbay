import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { AuditAction } from "@patchbay/audit";
import { ValidationStatus } from "@patchbay/domain";
import { POST } from "./route";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    webhookDelivery: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pullRequest: { findFirst: vi.fn(), update: vi.fn() },
    validationRun: { findFirst: vi.fn(), update: vi.fn() },
    repository: { findMany: vi.fn() },
    graphIndexJob: { create: vi.fn() },
    gitHubInstallation: { updateMany: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  Prisma: { InputJsonValue: "Prisma.InputJsonValue" },
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { GRAPH_INDEX: "GRAPH_INDEX" },
  enqueue: vi.fn(),
}));

const SECRET = "webhook-secret-for-tests";

function checkRunBody(
  overrides: {
    action?: string;
    conclusion?: string | null;
    checkId?: number;
    prNumber?: number | null;
  } = {},
): string {
  return JSON.stringify({
    action: overrides.action ?? "completed",
    repository: { id: 42 },
    check_run: {
      id: overrides.checkId ?? 9001,
      head_sha: "abc123",
      name: "ci / test",
      status: "completed",
      conclusion: overrides.conclusion === undefined ? "success" : overrides.conclusion,
      html_url: "https://github.com/o/r/runs/9001",
    },
    pull_requests: overrides.prNumber === null ? [] : [{ number: overrides.prNumber ?? 7 }],
  });
}

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function checkRunRequest(body: string): NextRequest {
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-delivery": `delivery-${body.length}-${body.slice(10, 18)}`,
      "x-github-event": "check_run",
      "x-hub-signature-256": sign(body),
    },
    body,
  }) as NextRequest;
}

function skippedRun(metadata: unknown = null) {
  return {
    id: "val-1",
    organizationId: "org-1",
    status: ValidationStatus.SKIPPED,
    runtimeMetadata: metadata,
  };
}

describe("POST /api/webhooks/github (check_run verdict ingestion)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    vi.mocked(prisma.webhookDelivery.create).mockResolvedValue({ id: "receipt-1" } as never);
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as never);
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValue({
      id: "pr-1",
      organizationId: "org-1",
      remediationPlanId: "plan-1",
    } as never);
    vi.mocked(prisma.validationRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("flips a SKIPPED run to PASSED on a success conclusion with evidence + audit", async () => {
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue(skippedRun() as never);
    const response = await POST(checkRunRequest(checkRunBody()));
    expect(response.status).toBe(200);
    expect(prisma.validationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "val-1" },
        data: expect.objectContaining({ status: ValidationStatus.PASSED }),
      }),
    );
    const updateData = vi.mocked(prisma.validationRun.update).mock.calls[0]?.[0] as unknown as {
      data: { runtimeMetadata: { customerChecks: Record<string, { conclusion: string }> } };
    };
    expect(updateData.data.runtimeMetadata.customerChecks["9001"]?.conclusion).toBe("success");
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AuditAction.PLAN_VALIDATION_PASSED }),
      }),
    );
  });

  it("flips a SKIPPED run to FAILED on a failure conclusion", async () => {
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue(skippedRun() as never);
    const response = await POST(checkRunRequest(checkRunBody({ conclusion: "failure" })));
    expect(response.status).toBe(200);
    expect(prisma.validationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ValidationStatus.FAILED }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AuditAction.PLAN_VALIDATION_FAILED }),
      }),
    );
  });

  it("flips PASSED back to FAILED on a later failure (fail-closed, audited)", async () => {
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue({
      ...skippedRun(),
      status: ValidationStatus.PASSED,
    } as never);
    await POST(checkRunRequest(checkRunBody({ conclusion: "timed_out", checkId: 9002 })));
    expect(prisma.validationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: ValidationStatus.FAILED }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AuditAction.PLAN_VALIDATION_FAILED }),
      }),
    );
  });

  it("records evidence without transition or audit on a second success", async () => {
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue({
      ...skippedRun(),
      status: ValidationStatus.PASSED,
    } as never);
    await POST(checkRunRequest(checkRunBody({ checkId: 9003 })));
    const updateData = vi.mocked(prisma.validationRun.update).mock.calls[0]?.[0] as unknown as {
      data: { status?: string };
    };
    expect(updateData.data.status).toBeUndefined();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("records evidence without transition on neutral conclusions", async () => {
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue(skippedRun() as never);
    await POST(checkRunRequest(checkRunBody({ conclusion: "neutral" })));
    expect(prisma.validationRun.update).toHaveBeenCalled();
    const updateData = vi.mocked(prisma.validationRun.update).mock.calls[0]?.[0] as unknown as {
      data: { status?: string };
    };
    expect(updateData.data.status).toBeUndefined();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("reprocessing the same check_run id is a no-op merge (no writes)", async () => {
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue(
      skippedRun({
        customerChecks: { 9001: { name: "ci / test", conclusion: "success" } },
      }) as never,
    );
    await POST(checkRunRequest(checkRunBody()));
    expect(prisma.validationRun.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("ignores non-completed actions before any PR lookup", async () => {
    await POST(checkRunRequest(checkRunBody({ action: "created" })));
    expect(prisma.pullRequest.findFirst).not.toHaveBeenCalled();
    expect(prisma.validationRun.update).not.toHaveBeenCalled();
  });

  it("ignores check runs that scope to no pull request", async () => {
    await POST(checkRunRequest(checkRunBody({ prNumber: null })));
    expect(prisma.pullRequest.findFirst).not.toHaveBeenCalled();
  });

  it("ignores check runs for unknown pull requests", async () => {
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValue(null);
    await POST(checkRunRequest(checkRunBody()));
    expect(prisma.validationRun.findFirst).not.toHaveBeenCalled();
    expect(prisma.validationRun.update).not.toHaveBeenCalled();
  });
});
