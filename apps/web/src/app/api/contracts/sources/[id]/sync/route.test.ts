import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    contractSource: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { POLL_NPM_REGISTRY: "POLL_NPM_REGISTRY" },
  enqueue: vi.fn(),
  queue: { getJob: vi.fn() },
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue, queue } from "@patchbay/queue";

function request(): NextRequest {
  return new Request("http://localhost/api/contracts/sources/src-1/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

const params = { params: Promise.resolve({ id: "src-1" }) };
const npmSource = { id: "src-1", vendorSlug: "stripe", kind: "SDK", organizationId: "org-acme" };

describe("POST /api/contracts/sources/[id]/sync (WP12)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(queue.getJob).mockResolvedValue(null as never);
    vi.mocked(enqueue).mockResolvedValue({ id: "job-1" } as never);
  });

  it("enqueues a vendor poll with an hourly idempotency key", async () => {
    vi.mocked(prisma.contractSource.findFirst).mockResolvedValueOnce(npmSource as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(
      "POLL_NPM_REGISTRY",
      expect.objectContaining({ vendorSlug: "stripe" }),
      { jobId: expect.stringMatching(/^contract-sync:src-1:\d{10}$/) },
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "contract_source.synced" }),
      }),
    );
  });

  it("collapses double-clicks onto the in-flight sync (duplicate)", async () => {
    vi.mocked(prisma.contractSource.findFirst).mockResolvedValueOnce(npmSource as never);
    vi.mocked(queue.getJob).mockResolvedValueOnce({ id: "existing" } as never);
    const response = await POST(request(), params);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { data: { duplicate: boolean } };
    expect(body.data.duplicate).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails closed for kinds without a producer and for foreign sources", async () => {
    vi.mocked(prisma.contractSource.findFirst).mockResolvedValueOnce({
      ...npmSource,
      kind: "ASYNC",
    } as never);
    await expect(POST(request(), params)).resolves.toMatchObject({ status: 422 });
    vi.mocked(prisma.contractSource.findFirst).mockResolvedValueOnce(null);
    await expect(POST(request(), params)).resolves.toMatchObject({ status: 404 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
