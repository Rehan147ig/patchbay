import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    notification: { findFirst: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  withOrgContext: (client: never) => client,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

function requestWithCsrf(body: unknown): NextRequest {
  return new Request("http://localhost/api/notifications/read", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "pb_csrf=token123",
      "x-csrf-token": "token123",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("POST /api/notifications/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.notification.findFirst).mockResolvedValue({
      id: "n-1",
      isRead: false,
    } as never);
    vi.mocked(prisma.notification.update).mockResolvedValue({
      id: "n-1",
      isRead: true,
    } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("requires MEMBER", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden("requires MEMBER") as never);
    const response = await POST(requestWithCsrf({ notificationId: "n-1" }));
    expect(response.status).toBe(403);
  });

  it("rejects an invalid body", async () => {
    const response = await POST(requestWithCsrf({}));
    expect(response.status).toBe(422);
  });

  it("marks the org's notification as read and writes an audit row", async () => {
    const response = await POST(requestWithCsrf({ notificationId: "n-1" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; isRead: boolean } };
    expect(body.data).toEqual({ id: "n-1", isRead: true });
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "n-1", organizationId: "org-acme" } }),
    );
    expect(prisma.notification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "n-1" },
        data: { isRead: true, readAt: expect.any(Date) },
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "notification.marked_read",
          entityType: "notification",
          entityId: "n-1",
          organizationId: "org-acme",
        }),
      }),
    );
  });

  it("returns 404 for a notification that is not in the org", async () => {
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null as never);
    const response = await POST(requestWithCsrf({ notificationId: "n-other" }));
    expect(response.status).toBe(404);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });
});
