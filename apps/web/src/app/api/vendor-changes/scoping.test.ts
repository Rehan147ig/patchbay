import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { GET as listChanges, POST as createChange } from "./route";
import { GET as getChange } from "./[id]/route";
import { POST as analyzeChange } from "./[id]/analyze/route";
import { GET as getPlan } from "../remediations/[id]/route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    vendor: { findUnique: vi.fn() },
    vendorChangeEvent: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    remediationPlan: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  withOrgContext: (client: unknown) => client,
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { ANALYZE_CHANGE: "ANALYZE_CHANGE" },
  queue: { add: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { queue } from "@patchbay/queue";
import { requireRole } from "@/lib/auth";

const acmeUser = { id: "u-acme", organizationId: "org-acme" };
const otherOrgUser = { id: "u-other", organizationId: "org-other" };

const acmeEvent = { id: "c-acme", title: "acme change", organizationId: "org-acme" };

function getRequest(url: string): NextRequest {
  return new Request(url) as NextRequest;
}

describe("org scoping across scoped routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(acmeUser as never);
    vi.mocked(prisma.vendorChangeEvent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.vendorChangeEvent.create).mockResolvedValue(acmeEvent as never);
    vi.mocked(prisma.vendorChangeEvent.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.remediationPlan.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({
      id: "v-openai",
      slug: "openai",
    } as never);
    vi.mocked(queue.add).mockResolvedValue(undefined as never);
  });

  it("lists only events of the caller's organization", async () => {
    vi.mocked(prisma.vendorChangeEvent.findMany).mockResolvedValueOnce([acmeEvent] as never);
    const response = await listChanges(getRequest("http://localhost/api/vendor-changes"));
    expect(response.status).toBe(200);
    expect(prisma.vendorChangeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-acme" } }),
    );
  });

  it("stamps caller's organization on created events", async () => {
    const response = await createChange(
      new Request("http://localhost/api/vendor-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorSlug: "openai",
          sourceType: "MANUAL",
          title: "test",
          severity: "HIGH",
        }),
      }) as NextRequest,
    );
    expect(response.status).toBe(201);
    expect(prisma.vendorChangeEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org-acme" }),
      }),
    );
  });

  it("returns 404 when fetching an event of another organization", async () => {
    const response = await getChange(getRequest("http://localhost/api/vendor-changes/c-other"), {
      params: Promise.resolve({ id: "c-other" }),
    });
    expect(response.status).toBe(404);
    expect(prisma.vendorChangeEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c-other", organizationId: "org-acme" } }),
    );
  });

  it("allows fetching an event owned by the caller's organization", async () => {
    vi.mocked(prisma.vendorChangeEvent.findFirst).mockResolvedValueOnce(acmeEvent as never);
    const response = await getChange(getRequest("http://localhost/api/vendor-changes/c-acme"), {
      params: Promise.resolve({ id: "c-acme" }),
    });
    expect(response.status).toBe(200);
    expect(prisma.vendorChangeEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c-acme", organizationId: "org-acme" } }),
    );
  });

  it("refuses to enqueue analysis for an event of another organization", async () => {
    const response = await analyzeChange(
      getRequest("http://localhost/api/vendor-changes/c-other/analyze"),
      {
        params: Promise.resolve({ id: "c-other" }),
      },
    );
    expect(response.status).toBe(422);
    expect(prisma.vendorChangeEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c-other", organizationId: "org-acme" } }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("scopes remediation plans through the repository's organization", async () => {
    const response = await getPlan(getRequest("http://localhost/api/remediations/plan-other"), {
      params: Promise.resolve({ id: "plan-other" }),
    });
    expect(response.status).toBe(404);
    expect(prisma.remediationPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "plan-other",
          impactAssessment: { repository: { organizationId: "org-acme" } },
        },
      }),
    );
  });

  it("does not let another organization see the caller's plans", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(otherOrgUser as never);
    const response = await getPlan(getRequest("http://localhost/api/remediations/plan-acme"), {
      params: Promise.resolve({ id: "plan-acme" }),
    });
    expect(response.status).toBe(404);
    expect(prisma.remediationPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "plan-acme",
          impactAssessment: { repository: { organizationId: "org-other" } },
        },
      }),
    );
  });
});
