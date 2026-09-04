import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";
import {
  auditExportTokenLookupPrefix,
  generateAuditExportToken,
  hashAuditExportToken,
} from "@/lib/audit-export-tokens";

vi.mock("@patchbay/db", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    auditEvent: { findMany: vi.fn(), create: vi.fn() },
  },
  withOrgContext: (client: unknown) => client,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkGlobalRateLimit: vi.fn(),
}));

import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { checkGlobalRateLimit } from "@/lib/rate-limit";

const EXPORT_TOKEN = generateAuditExportToken();
let exportHash = "";

const EVENTS = [
  {
    id: "evt-1",
    organizationId: "org-acme",
    actorType: "SYSTEM",
    actorId: null,
    action: "scan.completed",
    entityType: "repository",
    entityId: "repo-1",
    correlationId: "c-1",
    beforeJson: null,
    afterJson: { usageCount: 3 },
    createdAt: new Date("2026-09-03T00:00:00.000Z"),
  },
  {
    id: "evt-2",
    organizationId: "org-acme",
    actorType: "USER",
    actorId: "u-1",
    action: "approval.recorded",
    entityType: "remediationPlan",
    entityId: "p-1",
    correlationId: "c-2",
    beforeJson: null,
    afterJson: { apiKey: "sk-live-should-be-redacted" },
    createdAt: new Date("2026-09-03T01:00:00.000Z"),
  },
];

function exportRequest(
  query: string,
  opts: { token?: string | null; useSession?: boolean } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.token !== null && !opts.useSession) {
    headers.authorization = `Bearer ${opts.token ?? EXPORT_TOKEN}`;
  }
  const url = `http://localhost/api/audit/export${query}`;
  const request = new Request(url, { headers }) as NextRequest;
  // Plain Request lacks the Next.js nextUrl extension: attach it explicitly.
  Object.defineProperty(request, "nextUrl", { value: new URL(url), configurable: true });
  return request;
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.PATCH_REGISTRY_SIGNING_KEY = "test-export-signing-key";
  vi.mocked(checkGlobalRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(requireRole).mockResolvedValue({
    id: "u-admin",
    organizationId: "org-acme",
    role: "ADMIN",
  } as never);
  exportHash = await hashAuditExportToken(EXPORT_TOKEN);
  vi.mocked(prisma.organization.findFirst).mockImplementation((async (args: unknown) => {
    const where = (args as { where: { auditExportTokenPrefix: string } }).where;
    if (where.auditExportTokenPrefix === auditExportTokenLookupPrefix(EXPORT_TOKEN)) {
      return {
        id: "org-acme",
        auditExportTokenHash: exportHash,
        auditExportTokenHashPrevious: null,
      };
    }
    return null;
  }) as never);
  vi.mocked(prisma.auditEvent.findMany).mockResolvedValue(EVENTS as never);
  vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
});

describe("GET /api/audit/export", () => {
  it("streams JSONL by default with an HMAC signature bound to the org", async () => {
    const response = await GET(exportRequest("?limit=10"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const body = await response.text();
    const lines = body.split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { organizationId: string };
      expect(parsed.organizationId).toBe("org-acme");
    }
    const expected = createHmac("sha256", "test-export-signing-key")
      .update(`org-acme\n${body}`)
      .digest("hex");
    expect(response.headers.get("x-patch-export-signature")).toBe(expected);
  });

  it("redacts secrets inside exported payloads", async () => {
    const response = await GET(exportRequest("?limit=10"));
    const body = await response.text();
    expect(body).not.toContain("sk-live-should-be-redacted");
    expect(body).toContain("[REDACTED]");
  });

  it("switches to CEF with severity mapping", async () => {
    const response = await GET(exportRequest("?format=cef&limit=10"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("CEF:0|Patchbay|Autonomous Remediation Engine|1.0|");
    expect(body).toContain("approval.recorded|approval.recorded|7|");
    expect(body).toContain("scan.completed|scan.completed|2|");
  });

  it("paginates with a stable cursor and reports continuation", async () => {
    vi.mocked(prisma.auditEvent.findMany).mockResolvedValueOnce([EVENTS[0], EVENTS[1]] as never);
    const first = await GET(exportRequest("?limit=1"));
    expect(first.status).toBe(200);
    const nextCursor = first.headers.get("x-patch-export-next-cursor");
    expect(nextCursor).toBe("2026-09-03T00:00:00.000Z|evt-1");

    vi.mocked(prisma.auditEvent.findMany).mockResolvedValueOnce([EVENTS[1]] as never);
    const second = await GET(exportRequest(`?limit=1&cursor=${encodeURIComponent(nextCursor!)}`));
    const query = vi.mocked(prisma.auditEvent.findMany).mock.calls[1]?.[0] as {
      where: { OR: unknown };
    };
    expect(query.where.OR).toEqual([
      { createdAt: { gt: new Date("2026-09-03T00:00:00.000Z") } },
      { createdAt: new Date("2026-09-03T00:00:00.000Z"), id: { gt: "evt-1" } },
    ]);
    expect(second.headers.get("x-patch-export-next-cursor")).toBeNull();
  });

  it("rejects malformed cursors and formats with 422", async () => {
    expect((await GET(exportRequest("?cursor=nope"))).status).toBe(422);
    expect((await GET(exportRequest("?format=xml"))).status).toBe(422);
  });

  it("scopes every query to the token's organization", async () => {
    await GET(exportRequest("?limit=10"));
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-acme" }),
      }),
    );
  });

  it("rejects unknown bearer tokens without touching audit data", async () => {
    const response = await GET(exportRequest("?limit=10", { token: generateAuditExportToken() }));
    expect(response.status).toBe(401);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("records one AUDIT_LOG_EXPORTED event per request", async () => {
    await GET(exportRequest("?format=cef&limit=10"));
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-acme",
          action: "audit.log_exported",
          entityType: "audit_export",
        }),
      }),
    );
  });

  it("serves ADMIN sessions without a bearer token", async () => {
    const response = await GET(exportRequest("?limit=10", { useSession: true }));
    expect(response.status).toBe(200);
    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });
});
