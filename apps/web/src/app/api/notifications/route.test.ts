import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { forbidden } from "@patchbay/domain";
import { GET } from "./route";

vi.mock("@patchbay/db", () => ({
  prisma: {
    notification: { findMany: vi.fn(), count: vi.fn() },
  },
  withOrgContext: (client: never) => client,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";

const request = (url = "http://localhost/api/notifications") =>
  new Request(url, { headers: { Accept: "application/json" } }) as NextRequest;

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue({
      id: "u-1",
      organizationId: "org-acme",
    } as never);
    vi.mocked(prisma.notification.findMany).mockResolvedValue([
      {
        id: "n-1",
        type: "scan.completed",
        title: "Scan completed: acme/app",
        body: "3 usages indexed across 2 files",
        isRead: false,
        createdAt: new Date("2026-08-19T10:00:00Z"),
      },
    ] as never);
    vi.mocked(prisma.notification.count).mockResolvedValue(1 as never);
  });

  it("requires VIEWER", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(forbidden("requires VIEWER") as never);
    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("lists the org's notifications with the unread count", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { notifications: Array<{ id: string }>; unreadCount: number };
    };
    expect(body.data.unreadCount).toBe(1);
    expect(body.data.notifications[0]?.id).toBe("n-1");
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-acme" },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
    expect(prisma.notification.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-acme", isRead: false } }),
    );
  });

  it("returns no notifications and a zero count for an empty org", async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.notification.count).mockResolvedValue(0 as never);
    const response = await GET(request());
    const body = (await response.json()) as {
      data: { notifications: unknown[]; unreadCount: number };
    };
    expect(body.data.notifications).toEqual([]);
    expect(body.data.unreadCount).toBe(0);
  });
});
