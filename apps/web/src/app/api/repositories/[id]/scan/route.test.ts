import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    repository: { findFirst: vi.fn() },
    repositoryScan: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { SCAN_REPOSITORY: "scan-repository" },
  enqueue: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

const memberUser = { id: "u-member", organizationId: "org-acme" };

function requestWithCsrf(): NextRequest {
  return new Request("http://localhost/api/repositories/repo-1/scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
  }) as NextRequest;
}

describe("POST /api/repositories/[id]/scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(prisma.repository.findFirst).mockResolvedValue({
      id: "repo-1",
      organizationId: "org-acme",
      metadata: { fixture: "openai-node-legacy" },
    } as never);
    vi.mocked(prisma.repositoryScan.create).mockResolvedValue({
      id: "scan-1",
      repositoryId: "repo-1",
      status: "QUEUED",
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("creates a QUEUED scan and enqueues the worker job for a MEMBER", async () => {
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "repo-1" }) });
    expect(response.status).toBe(202);
    expect(prisma.repositoryScan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-acme",
          repositoryId: "repo-1",
          status: "QUEUED",
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith("scan-repository", {
      repositoryId: "repo-1",
      scanId: "scan-1",
      correlationId: expect.any(String),
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "scan.queued",
          entityId: "repo-1",
        }),
      }),
    );
  });

  it("returns 422 for repositories outside the organization", async () => {
    vi.mocked(prisma.repository.findFirst).mockResolvedValue(null as never);
    const response = await POST(requestWithCsrf(), { params: Promise.resolve({ id: "repo-1" }) });
    expect(response.status).toBe(422);
    expect(prisma.repositoryScan.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
