import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    capabilityGate: { findMany: vi.fn() },
    connectorCertification: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

describe("GET /api/operations/capabilities (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
  });

  it("returns org gates joined with the certification catalog", async () => {
    vi.mocked(prisma.capabilityGate.findMany).mockResolvedValueOnce([
      { vendorSlug: "stripe", level: "DRAFT_PR", status: "SUSPENDED", consecutiveBreaches: 2 },
    ] as never);
    vi.mocked(prisma.connectorCertification.findMany).mockResolvedValueOnce([
      { connectorSlug: "stripe", capability: "DRAFT_PR", status: "CERTIFIED" },
    ] as never);
    const response = await GET(
      new Request("http://localhost/api/operations/capabilities") as NextRequest,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { gates: unknown[]; certifications: unknown[] };
    };
    expect(body.data.gates).toHaveLength(1);
    expect(body.data.certifications).toHaveLength(1);
    expect(prisma.capabilityGate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-acme" } }),
    );
    expect(prisma.connectorCertification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "CERTIFIED" } }),
    );
  });
});
