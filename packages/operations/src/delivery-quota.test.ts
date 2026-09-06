import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDeliveryQuota,
  effectiveQuotaTier,
  monthStartUtc,
  quotaBlockedMessage,
} from "./delivery-quota";

function makePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    subscription: { findUnique: vi.fn().mockResolvedValue(null) },
    pullRequest: { count: vi.fn().mockResolvedValue(0) },
    validationRun: { count: vi.fn().mockResolvedValue(0) },
  };
  return { ...base, ...overrides } as typeof base & typeof overrides;
}

describe("monthStartUtc", () => {
  it("pins the first instant of the UTC month", () => {
    expect(monthStartUtc(new Date("2026-09-15T23:00:00Z"))).toEqual(
      new Date("2026-09-01T00:00:00Z"),
    );
  });
});

describe("effectiveQuotaTier", () => {
  it("grants the paid tier only for ACTIVE/PAST_DUE", () => {
    expect(effectiveQuotaTier({ status: "ACTIVE", planTier: "PRO" })).toBe("PRO");
    expect(effectiveQuotaTier({ status: "PAST_DUE", planTier: "TEAM" })).toBe("TEAM");
    expect(effectiveQuotaTier({ status: "CANCELED", planTier: "PRO" })).toBe("FREE");
    expect(effectiveQuotaTier({ status: null, planTier: null })).toBe("FREE");
  });
});

describe("checkDeliveryQuota", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("defaults missing subscriptions to FREE quotas", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.pullRequest.count).mockResolvedValueOnce(9);
    const result = await checkDeliveryQuota(prisma, {
      organizationId: "org-1",
      kind: "DRAFT_PR",
      now: new Date("2026-09-06T00:00:00Z"),
    });
    expect(result).toMatchObject({ allowed: true, tier: "FREE", quota: 10, used: 9, remaining: 1 });
    expect(prisma.pullRequest.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", createdAt: { gte: new Date("2026-09-01T00:00:00Z") } },
    });
  });

  it("blocks at the cap with zero remaining (never silently)", async () => {
    const prisma = makePrisma();
    vi.mocked(prisma.pullRequest.count).mockResolvedValueOnce(10);
    const result = await checkDeliveryQuota(prisma, {
      organizationId: "org-1",
      kind: "DRAFT_PR",
      now: new Date("2026-09-06T00:00:00Z"),
    });
    expect(result).toMatchObject({ allowed: false, quota: 10, used: 10, remaining: 0 });
    expect(quotaBlockedMessage(result)).toMatch(/Monthly draft PRs quota exceeded.*10\/10 used/);
  });

  it("counts non-skipped validations against the VALIDATE quota", async () => {
    const prisma = makePrisma({
      subscription: {
        findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", planTier: "PRO" }),
      },
    });
    vi.mocked(prisma.validationRun.count).mockResolvedValueOnce(999);
    const result = await checkDeliveryQuota(prisma, {
      organizationId: "org-1",
      kind: "VALIDATE",
    });
    expect(result).toMatchObject({ allowed: true, tier: "PRO", quota: 1000, used: 999 });
    // SKIPPED runs (customer CI did the work) consume nothing.
    expect(prisma.validationRun.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: { not: "SKIPPED" } }),
    });
  });

  it("treats ENTERPRISE as unlimited", async () => {
    const prisma = makePrisma({
      subscription: {
        findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", planTier: "ENTERPRISE" }),
      },
    });
    const result = await checkDeliveryQuota(prisma, {
      organizationId: "org-1",
      kind: "DRAFT_PR",
    });
    expect(result).toMatchObject({ allowed: true, quota: null, remaining: null });
    expect(prisma.pullRequest.count).not.toHaveBeenCalled();
  });
});
