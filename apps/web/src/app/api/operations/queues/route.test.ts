import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PatchbayError } from "@patchbay/domain";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    deadLetterJob: { count: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/queue")>("@patchbay/queue");
  return {
    ...actual,
    queue: {
      getJobCounts: vi.fn(),
    },
    dlqQueue: {
      getJobCounts: vi.fn(),
    },
    readWorkerHeartbeats: vi.fn(),
  };
});

vi.mock("@patchbay/telemetry", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/telemetry")>("@patchbay/telemetry");
  return {
    ...actual,
    getJobMirrorSnapshot: vi.fn(() => ({})),
  };
});

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { dlqQueue, queue, readWorkerHeartbeats } from "@patchbay/queue";

const adminUser = { id: "u-admin", organizationId: "org-acme" };

function request(): NextRequest {
  return new Request("http://localhost/api/operations/queues", { method: "GET" }) as NextRequest;
}

describe("GET /api/operations/queues (WP10)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue(adminUser as never);
    vi.mocked(prisma.deadLetterJob.count).mockResolvedValue(3);
    vi.mocked(queue.getJobCounts).mockResolvedValue({ waiting: 2, active: 1 } as never);
    vi.mocked(dlqQueue.getJobCounts).mockResolvedValue({ waiting: 1 } as never);
    vi.mocked(readWorkerHeartbeats).mockResolvedValue([
      { workerId: "w-1", startedAt: "x", lastBeatAt: "y", fresh: true },
    ]);
  });

  it("reports queue depth, DLQ, heartbeats, and job outcomes", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        status: string;
        queue: Record<string, number>;
        dlqQueue: Record<string, number>;
        openDeadLetters: number;
        workers: unknown[];
      };
    };
    expect(body.data.status).toBe("ok");
    expect(body.data.queue).toMatchObject({ waiting: 2, active: 1 });
    expect(body.data.dlqQueue).toMatchObject({ waiting: 1 });
    expect(body.data.openDeadLetters).toBe(3);
    expect(body.data.workers).toHaveLength(1);
    expect(prisma.deadLetterJob.count).toHaveBeenCalledWith({
      where: { organizationId: "org-acme", status: "OPEN" },
    });
  });

  it("degrades honestly when Redis is unreachable (no 500)", async () => {
    vi.mocked(queue.getJobCounts).mockRejectedValueOnce(new Error("redis down"));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { status: string; redis: string; queue: null; openDeadLetters: number };
    };
    expect(body.data.status).toBe("degraded");
    expect(body.data.redis).toBe("unreachable");
    expect(body.data.queue).toBeNull();
    // The DB count still answers through the outage.
    expect(body.data.openDeadLetters).toBe(3);
  });

  it("requires ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(
      new PatchbayError("Forbidden", { statusCode: 403, code: "FORBIDDEN" }),
    );
    const response = await GET(request());
    expect(response.status).toBe(403);
  });
});
