import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    prOutcome: { findMany: vi.fn(), count: vi.fn() },
  },
  withOrgContext: (client: never) => client,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function listRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/outcomes${query}`);
}

describe("GET /api/outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.prOutcome.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.prOutcome.count).mockResolvedValue(0 as never);
  });

  it("lists outcomes with pull request and vendor linkage", async () => {
    vi.mocked(prisma.prOutcome.findMany).mockResolvedValue([
      {
        id: "outcome-1",
        organizationId: "org-acme",
        status: "MERGED",
        classification: "SUCCESS",
        source: "GITHUB_WEBHOOK",
        rulePackVersion: "rules-2.1.0",
        extractorVersion: "ext-3.0.0",
        pullRequest: {
          id: "pr-1",
          url: "https://github.com/acme/repo/pull/7",
          branchName: "patchbay/stripe-migration",
          status: "MERGED",
          remediationPlan: {
            id: "plan-1",
            confidence: 90,
            requiresHumanReview: false,
            impactAssessment: {
              changeEvent: {
                title: "stripe v14 released",
                vendor: { slug: "stripe", name: "Stripe" },
              },
            },
          },
        },
      },
    ] as never);
    vi.mocked(prisma.prOutcome.count).mockResolvedValue(1 as never);

    const response = await GET(listRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { outcomes: Array<{ classification: string }>; total: number };
    };
    expect(body.data.total).toBe(1);
    expect(body.data.outcomes[0].classification).toBe("SUCCESS");
  });

  it("applies status and classification filters", async () => {
    await GET(listRequest("?status=MERGED&classification=SUCCESS&offset=0&limit=25"));
    expect(prisma.prOutcome.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-acme",
          status: "MERGED",
          classification: "SUCCESS",
        }),
      }),
    );
  });

  it("rejects an invalid status filter", async () => {
    const response = await GET(listRequest("?status=NOPE"));
    expect(response.status).toBe(422);
  });
});
