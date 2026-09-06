import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { ANALYZE_CHANGE: "ANALYZE_CHANGE" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

function request(): NextRequest {
  return new Request("http://localhost/api/maintenance/cases/case-1/assess", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

const params = { params: Promise.resolve({ id: "case-1" }) };

describe("POST /api/maintenance/cases/[id]/assess (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("enqueues analysis for the case's change event", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({
      id: "case-1",
      status: "OBSERVED",
      impactAssessments: [{ changeEventId: "evt-1" }],
    } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(
      "ANALYZE_CHANGE",
      expect.objectContaining({ changeEventId: "evt-1", organizationId: "org-acme" }),
    );
  });

  it("conflicts on terminal cases and fails closed without assessments", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({
      id: "case-1",
      status: "CLOSED",
      impactAssessments: [{ changeEventId: "evt-1" }],
    } as never);
    await expect(POST(request(), params)).resolves.toMatchObject({ status: 409 });

    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce({
      id: "case-1",
      status: "OBSERVED",
      impactAssessments: [],
    } as never);
    await expect(POST(request(), params)).resolves.toMatchObject({ status: 422 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns 404 for foreign cases", async () => {
    vi.mocked(prisma.remediationCase.findFirst).mockResolvedValueOnce(null);
    await expect(POST(request(), params)).resolves.toMatchObject({ status: 404 });
  });
});
