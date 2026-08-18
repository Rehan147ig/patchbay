import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { DELETE } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
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
    auditEvent: { deleteMany: vi.fn(), create: vi.fn() },
  },
}));

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
      };
      if (typeof delegate?.deleteMany === "function") {
        delegate.deleteMany.mockResolvedValue({ count: 1 } as never);
      }
      if (typeof delegate?.create === "function") {
        delegate.create.mockResolvedValue({} as never);
      }
    }
  });

  it("requires ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("forbidden") as never);
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(500);
  });

  it("deletes every operational record of the organization", async () => {
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { deleted: number } };
    expect(body.data.deleted).toBeGreaterThan(0);
    expect(prisma.remediationCase.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-acme" },
    });
    expect(prisma.prOutcome.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-acme" },
    });
  });

  it("writes the DATA_DELETED marker before deleting and keeps it", async () => {
    await DELETE(deleteRequest());
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    const [markerArgs] = vi.mocked(prisma.auditEvent.create).mock.calls;
    expect(markerArgs[0].data.action).toBe("data.deleted");
    expect(prisma.auditEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-acme",
        action: { not: "data.deleted" },
      },
    });
  });
});
