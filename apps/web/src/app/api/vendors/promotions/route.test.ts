import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    remediationCase: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

const DAY = 86_400_000;
const NOW = Date.now();

function outcome(status: string, classification: string, daysAgo: number) {
  return {
    status,
    classification,
    validationRunId: "vr-1",
    createdAt: new Date(NOW - daysAgo * DAY),
  };
}

describe("GET /api/vendors/promotions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-member",
      organizationId: "org-acme",
    } as never);
  });

  it("proposes packages with a qualifying merge streak, eligible first", async () => {
    vi.mocked(prisma.remediationCase.findMany).mockResolvedValue([
      {
        id: "c-lodash",
        release: {
          product: { vendor: { slug: "npm-lodash" }, packageName: "lodash" },
        },
        outcomes: [1, 5, 12, 30, 60].map((d) => outcome("MERGED", "SUCCESS", d)),
      },
      {
        id: "c-leftpad",
        release: {
          product: { vendor: { slug: "npm-leftpad" }, packageName: "left-pad" },
        },
        outcomes: [1].map((d) => outcome("MERGED", "SUCCESS", d)),
      },
    ] as never);

    const response = await GET(
      new Request("http://localhost/api/vendors/promotions") as NextRequest,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        proposals: Array<{
          vendorSlug: string;
          packageName: string;
          eligible: boolean;
          reasons: string[];
          evidence: { mergedStreak: number };
        }>;
      };
    };
    expect(body.data.proposals).toHaveLength(2);
    expect(body.data.proposals[0]?.packageName).toBe("lodash");
    expect(body.data.proposals[0]?.eligible).toBe(true);
    expect(body.data.proposals[0]?.evidence.mergedStreak).toBe(5);
    expect(body.data.proposals[1]?.packageName).toBe("left-pad");
    expect(body.data.proposals[1]?.eligible).toBe(false);
  });

  it("returns an empty list when nothing ran on the autonomous track", async () => {
    vi.mocked(prisma.remediationCase.findMany).mockResolvedValue([]);
    const response = await GET(
      new Request("http://localhost/api/vendors/promotions") as NextRequest,
    );
    const body = (await response.json()) as { data: { proposals: unknown[] } };
    expect(body.data.proposals).toEqual([]);
  });
});
