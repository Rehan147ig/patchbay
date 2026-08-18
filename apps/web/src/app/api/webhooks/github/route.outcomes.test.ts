import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    webhookDelivery: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pullRequest: { findFirst: vi.fn(), update: vi.fn() },
    gitHubInstallation: { updateMany: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    prOutcome: { findUnique: vi.fn(), upsert: vi.fn() },
    agentRun: { findFirst: vi.fn() },
    validationRun: { findFirst: vi.fn() },
    remediationCase: { findUnique: vi.fn(), update: vi.fn() },
    remediationCaseEvent: { create: vi.fn() },
  },
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { EVALUATE_CAPABILITY_HEALTH: "EVALUATE_CAPABILITY_HEALTH" },
  enqueue: vi.fn(),
}));

vi.mock("@patchbay/vendor-connectors", () => ({
  getCapability: vi.fn().mockReturnValue({
    level: "DRAFT_PR",
    rulePackVersion: "rules-2.1.0",
    extractorVersion: "ext-3.0.0",
  }),
}));

import { prisma } from "@patchbay/db";
import { enqueue } from "@patchbay/queue";

const SECRET = "webhook-secret-for-tests";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function mergedRequest(): NextRequest {
  const body = JSON.stringify({
    action: "closed",
    repository: { id: 42 },
    pull_request: { number: 7, state: "closed", merged: true, draft: false },
  });
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    headers: {
      "x-github-delivery": "delivery-9",
      "x-github-event": "pull_request",
      "x-hub-signature-256": sign(body),
    },
    body,
  }) as NextRequest;
}

function pullRequestRow() {
  return {
    id: "pr-1",
    organizationId: "org-acme",
    status: "OPEN",
    remediationPlan: {
      id: "plan-1",
      remediationCaseId: "case-1",
      policyDecision: { decision: "ALLOW_VALIDATE" },
      impactAssessment: {
        changeEvent: { vendor: { slug: "stripe" } },
      },
    },
  };
}

describe("POST /api/webhooks/github (WP10 outcome ingestion)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
    vi.mocked(prisma.webhookDelivery.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.webhookDelivery.create).mockResolvedValue({
      id: "w-9",
      deliveryId: "delivery-9",
      event: "pull_request",
      payloadHash: "h",
      status: "RECEIVED",
      receivedAt: new Date(),
    } as never);
    vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as never);
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValue(pullRequestRow() as never);
    vi.mocked(prisma.pullRequest.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.prOutcome.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.prOutcome.upsert).mockResolvedValue({ id: "outcome-1" } as never);
    vi.mocked(prisma.agentRun.findFirst).mockResolvedValue({
      model: "mock",
      promptTemplateVersion: "prompt-1.4.0",
    } as never);
    vi.mocked(prisma.validationRun.findFirst).mockResolvedValue({ id: "val-1" } as never);
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue({
      id: "case-1",
      organizationId: "org-acme",
      status: "APPROVAL_REQUIRED",
      snapshotId: "snap-1",
    } as never);
    vi.mocked(prisma.remediationCase.update).mockResolvedValue({} as never);
    vi.mocked(prisma.remediationCaseEvent.create).mockResolvedValue({} as never);
  });

  it("records a linked outcome when a PR merges and closes its case", async () => {
    const response = await POST(mergedRequest());
    expect(response.status).toBe(200);

    expect(prisma.prOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pullRequestId: "pr-1" },
        create: expect.objectContaining({
          organizationId: "org-acme",
          status: "MERGED",
          classification: "UNCLASSIFIED",
          source: "GITHUB_WEBHOOK",
          caseId: "case-1",
          rulePackVersion: "rules-2.1.0",
          extractorVersion: "ext-3.0.0",
          modelVersion: "mock",
          promptTemplateVersion: "prompt-1.4.0",
          validationRunId: "val-1",
          graphSnapshotId: "snap-1",
          policyDecision: { decision: "ALLOW_VALIDATE" },
        }),
      }),
    );

    // Case transition to the MERGED terminal state.
    expect(prisma.remediationCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "MERGED", terminalOutcome: "PR_MERGED" }),
      }),
    );
    expect(prisma.remediationCaseEvent.create).toHaveBeenCalledTimes(1);

    // Auto-suspend evaluation is triggered.
    expect(enqueue).toHaveBeenCalledWith("EVALUATE_CAPABILITY_HEALTH", {
      organizationId: "org-acme",
      vendorSlug: "stripe",
      correlationId: expect.any(String),
    });
  });

  it("links the snapshot of the case actually loaded", async () => {
    vi.mocked(prisma.remediationCase.findUnique).mockResolvedValue({
      id: "case-1",
      organizationId: "org-acme",
      status: "APPROVAL_REQUIRED",
      snapshotId: "snap-2",
    } as never);
    await POST(mergedRequest());
    expect(prisma.prOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ graphSnapshotId: "snap-2" }),
      }),
    );
  });

  it("ignores non-terminal transitions (no outcome written)", async () => {
    vi.mocked(prisma.pullRequest.findFirst).mockResolvedValue({
      id: "pr-1",
      organizationId: "org-acme",
      status: "DRAFT",
      remediationPlan: null,
    } as never);
    const body = JSON.stringify({
      action: "opened",
      repository: { id: 42 },
      pull_request: { number: 7, state: "open", draft: true },
    });
    const request = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: {
        "x-github-delivery": "delivery-10",
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(body),
      },
      body,
    }) as NextRequest;
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(prisma.prOutcome.upsert).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
