import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { unauthorized } from "@patchbay/domain";
import { GET } from "./route";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    detectionRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    releaseRecord: {
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/vendor-connectors", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/vendor-connectors")>(
    "@patchbay/vendor-connectors",
  );
  return {
    ...actual,
    getWatchtowerAdapters: vi.fn(),
  };
});

import { requireRole } from "@/lib/auth";
import { getWatchtowerAdapters } from "@patchbay/vendor-connectors";

function request(): NextRequest {
  return new Request("http://localhost/api/watchtower/health", { method: "GET" }) as NextRequest;
}

describe("GET /api/watchtower/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({ id: "user-1", role: "VIEWER" } as never);
    vi.mocked(getWatchtowerAdapters).mockReturnValue([
      {
        slug: "npm:openai",
        source: "NPM",
        supports: () => true,
        normalize: () => ({}) as never,
        fetch: () => Promise.resolve({ evidence: [], cursor: {} }),
      },
      {
        slug: "openapi:stripe",
        source: "OPENAPI",
        supports: () => true,
        normalize: () => ({}) as never,
        fetch: () => Promise.resolve({ evidence: [], cursor: {} }),
      },
    ] as never);
  });

  it("returns per-detector health with trust profile, latency, error rate and cursor state", async () => {
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValue({
      id: "run-1",
      adapter: "npm:openai",
      status: "COMPLETED",
      startedAt: new Date("2026-08-01T00:00:00Z"),
      completedAt: new Date("2026-08-01T00:00:01Z"),
      latencyMs: 500,
      observedCount: 2,
      cursor: { etag: '"x"' },
      error: null,
      rejectionReason: null,
    } as never);
    vi.mocked(prisma.detectionRun.findMany).mockResolvedValue([
      { status: "COMPLETED", latencyMs: 500, observedCount: 2, rejectionReason: null },
      { status: "COMPLETED", latencyMs: 300, observedCount: 0, rejectionReason: null },
      {
        status: "FAILED",
        latencyMs: null,
        observedCount: 0,
        rejectionReason: "domain_not_allowed",
      },
    ] as never);
    vi.mocked(prisma.releaseRecord.groupBy)
      .mockResolvedValueOnce([{ status: "OBSERVED", _count: { _all: 3 } }] as never)
      .mockResolvedValueOnce([
        { authenticity: "SOURCE_TRUSTED", _count: { _all: 2 } },
        { authenticity: "UNVERIFIED", _count: { _all: 1 } },
      ] as never);

    const response = await GET(request());
    const body = (await response.json()) as {
      data: {
        adapters: {
          slug: string;
          lastRun: { cursorPresent: boolean; latencyMs: number };
          window: { errorRate: number; avgLatencyMs: number; observedTotal: number };
          lastRejection: string | null;
          profile: { allowedDomains: string[]; evidenceAuthenticity: string };
        }[];
        global: { backlog: Record<string, number>; authenticity: Record<string, number> };
      };
    };
    const { adapters, global } = body.data;

    expect(response.status).toBe(200);
    expect(adapters).toHaveLength(2);
    const npm = adapters.find((a) => a.slug === "npm:openai")!;
    expect(npm.lastRun.cursorPresent).toBe(true);
    expect(npm.lastRun.latencyMs).toBe(500);
    expect(npm.window.errorRate).toBeCloseTo(1 / 3, 3);
    expect(npm.window.avgLatencyMs).toBe(400);
    expect(npm.window.observedTotal).toBe(2);
    expect(npm.lastRejection).toBe("domain_not_allowed");
    expect(npm.profile.allowedDomains).toContain("registry.npmjs.org");
    expect(npm.profile.evidenceAuthenticity).toBe("SOURCE_TRUSTED");

    const openapi = adapters.find((a) => a.slug === "openapi:stripe")!;
    expect(openapi.profile.evidenceAuthenticity).toBe("UNVERIFIED");

    expect(global.backlog).toEqual({ OBSERVED: 3 });
    expect(global.authenticity).toEqual({ SOURCE_TRUSTED: 2, UNVERIFIED: 1 });
  });

  it("handles a detector with no runs yet", async () => {
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.detectionRun.findMany).mockResolvedValue([]);
    vi.mocked(prisma.releaseRecord.groupBy)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const response = await GET(request());
    const body = (await response.json()) as {
      data: { adapters: { slug: string; lastRun: null; window: { errorRate: number } }[] };
    };

    expect(response.status).toBe(200);
    const npm = body.data.adapters.find((a) => a.slug === "npm:openai")!;
    expect(npm.lastRun).toBeNull();
    expect(npm.window.errorRate).toBe(0);
  });

  it("rejects unauthenticated callers", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(unauthorized("Authentication required"));

    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(prisma.detectionRun.findFirst).not.toHaveBeenCalled();
  });
});
