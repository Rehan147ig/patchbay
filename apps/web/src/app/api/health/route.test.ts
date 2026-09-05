import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";
import { prisma } from "@patchbay/db";
import { connection, queue } from "@patchbay/queue";

vi.mock("@patchbay/db", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

vi.mock("@patchbay/queue", () => ({
  connection: { ping: vi.fn() },
  queue: { getJobCounts: vi.fn() },
}));

function request(): NextRequest {
  return new Request("http://localhost/api/health", { method: "GET" }) as NextRequest;
}

describe("GET /api/health", () => {
  it("reports ok with queue backlog when every dependency answers", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
    vi.mocked(connection.ping).mockResolvedValue("PONG" as never);
    vi.mocked(queue.getJobCounts).mockResolvedValue({
      waiting: 2,
      active: 1,
      delayed: 0,
      failed: 0,
    } as never);
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      status: "ok",
      db: "ok",
      redis: "ok",
      queue: { waiting: 2, active: 1, delayed: 0, failed: 0 },
    });
  });

  it("goes degraded 503 when Redis is unreachable, even with a healthy DB", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
    vi.mocked(connection.ping).mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.mocked(queue.getJobCounts).mockRejectedValue(new Error("connect ECONNREFUSED"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ status: "degraded", db: "ok", redis: "unreachable" });
  });

  it("goes degraded 503 when the database is unreachable", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("db down"));
    vi.mocked(connection.ping).mockResolvedValue("PONG" as never);
    vi.mocked(queue.getJobCounts).mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    } as never);
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      status: "degraded",
      db: "unreachable",
      redis: "ok",
    });
  });
});
