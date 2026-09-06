import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { PATCH } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    repository: { findFirst: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/repositories/repo-1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

const params = { params: Promise.resolve({ id: "repo-1" }) };

describe("PATCH /api/repositories/[id] (WP12 fleet toggle)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("archives a monitored repository with a distinct audit event", async () => {
    vi.mocked(prisma.repository.findFirst).mockResolvedValueOnce({
      id: "repo-1",
      status: "ACTIVE",
      fullName: "acme/app",
    } as never);
    vi.mocked(prisma.repository.update).mockResolvedValueOnce({
      id: "repo-1",
      status: "ARCHIVED",
    } as never);
    const response = await PATCH(request({ status: "ARCHIVED" }), params);
    expect(response.status).toBe(200);
    expect(prisma.repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ARCHIVED" } }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "repository.archived" }),
      }),
    );
  });

  it("restores an archived repository and reports no-ops idempotently", async () => {
    vi.mocked(prisma.repository.findFirst).mockResolvedValueOnce({
      id: "repo-1",
      status: "ARCHIVED",
      fullName: "acme/app",
    } as never);
    vi.mocked(prisma.repository.update).mockResolvedValueOnce({
      id: "repo-1",
      status: "ACTIVE",
    } as never);
    const response = await PATCH(request({ status: "ACTIVE" }), params);
    expect(response.status).toBe(200);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "repository.restored" }),
      }),
    );

    vi.mocked(prisma.repository.findFirst).mockResolvedValueOnce({
      id: "repo-1",
      status: "ACTIVE",
      fullName: "acme/app",
    } as never);
    const noop = await PATCH(request({ status: "ACTIVE" }), params);
    const body = (await noop.json()) as { data: { unchanged: boolean } };
    expect(body.data.unchanged).toBe(true);
    expect(prisma.repository.update).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for foreign repositories and 422 for bad statuses", async () => {
    vi.mocked(prisma.repository.findFirst).mockResolvedValueOnce(null);
    await expect(PATCH(request({ status: "ARCHIVED" }), params)).resolves.toMatchObject({
      status: 404,
    });
    await expect(PATCH(request({ status: "DELETED" }), params)).resolves.toMatchObject({
      status: 422,
    });
  });
});
