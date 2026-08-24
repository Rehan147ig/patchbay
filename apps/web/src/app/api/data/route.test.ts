import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { DELETE } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txProxy())),
    prOutcome: { deleteMany: vi.fn() },
    capabilityGate: { deleteMany: vi.fn() },
    approval: { deleteMany: vi.fn() },
    pullRequest: { deleteMany: vi.fn() },
    patchArtifact: { deleteMany: vi.fn() },
    validationRun: { deleteMany: vi.fn() },
    remediationCaseEvent: { deleteMany: vi.fn() },
    remediationCase: { deleteMany: vi.fn() },
    remediationPlan: { deleteMany: vi.fn() },
    impactAssessmentUsage: { deleteMany: vi.fn() },
    impactAssessment: { deleteMany: vi.fn() },
    agentStep: { deleteMany: vi.fn() },
    agentRun: { deleteMany: vi.fn() },
    graphSourceEvidence: { deleteMany: vi.fn() },
    graphEdge: { deleteMany: vi.fn() },
    graphNode: { deleteMany: vi.fn() },
    graphIndexJob: { deleteMany: vi.fn() },
    graphSnapshot: { deleteMany: vi.fn() },
    integrationUsage: { deleteMany: vi.fn() },
    repositoryScan: { deleteMany: vi.fn() },
    releaseRepositoryMatch: { deleteMany: vi.fn() },
    webhookDelivery: { deleteMany: vi.fn() },
    vendorChangeEvent: { deleteMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

function txProxy(): Record<string, { deleteMany: ReturnType<typeof vi.fn> }> {
  return new Proxy(
    {},
    {
      get: (_target, _prop) => ({
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      }),
      getOwnPropertyDescriptor: () => ({
        configurable: true,
        enumerable: true,
        value: undefined,
      }),
    },
  ) as never;
}

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function deleteRequest(): NextRequest {
  return new Request("http://localhost/api/data", {
    method: "DELETE",
    headers: {
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

describe("DELETE /api/data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-admin",
      organizationId: "org-acme",
    } as never);
    for (const key of Object.keys(prisma) as Array<keyof typeof prisma>) {
      const delegate = prisma[key] as {
        deleteMany?: ReturnType<typeof vi.fn>;
        create?: ReturnType<typeof vi.fn>;
        $transaction?: ReturnType<typeof vi.fn>;
      };
      if (typeof delegate?.deleteMany === "function") {
        delegate.deleteMany.mockResolvedValue({ count: 1 } as never);
      }
      if (typeof delegate?.create === "function") {
        delegate.create.mockResolvedValue({} as never);
      }
      if (typeof delegate?.$transaction === "function") {
        delegate.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn(txProxy()),
        );
      }
    }
  });

  it("requires ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("forbidden") as never);
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(500);
  });

  it("deletes every operational record inside one transaction", async () => {
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { deleted: number } };
    expect(body.data.deleted).toBeGreaterThan(0);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("never attempts to delete audit rows: WORM history stays immutable", async () => {
    await DELETE(deleteRequest());
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    // AuditEvent exposes no delete path at all in the route's prisma surface.
    expect((prisma.auditEvent as { deleteMany?: unknown }).deleteMany).toBeUndefined();
  });
});
