import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditAction } from "@patchbay/audit";
import {
  evaluateFreshness,
  sweepWatchtowerStaleness,
  DEFAULT_STALENESS_MAX_AGE_MS,
} from "./watchtower-staleness";
import { prisma } from "@patchbay/db";
import { alertDlq } from "@patchbay/queue";
import { getWatchtowerAdapters } from "@patchbay/vendor-connectors";

vi.mock("@patchbay/db", () => ({
  prisma: {
    detectionRun: { findFirst: vi.fn() },
    organization: { upsert: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@patchbay/queue", () => ({
  alertDlq: vi.fn(),
}));

vi.mock("@patchbay/vendor-connectors", async () => {
  const actual = await vi.importActual<typeof import("@patchbay/vendor-connectors")>(
    "@patchbay/vendor-connectors",
  );
  return { ...actual, getWatchtowerAdapters: vi.fn() };
});

const NOW = new Date("2026-09-05T00:00:00Z");

function adapters(slugs: string[]) {
  vi.mocked(getWatchtowerAdapters).mockReturnValue(slugs.map((slug) => ({ slug }) as never));
}

describe("evaluateFreshness", () => {
  it("marks adapters stale past the max age and fresh within it", () => {
    const result = evaluateFreshness(
      new Map([
        ["npm:openai", new Date(NOW.getTime() - 10 * 60_000)],
        ["openapi:stripe", new Date(NOW.getTime() - 61 * 60_000)],
        ["npm:never", null],
      ]),
      NOW.getTime(),
      DEFAULT_STALENESS_MAX_AGE_MS,
    );
    expect(result).toEqual([
      { adapter: "npm:never", lastCompletedAt: null, stale: true },
      {
        adapter: "npm:openai",
        lastCompletedAt: new Date(NOW.getTime() - 10 * 60_000),
        stale: false,
      },
      {
        adapter: "openapi:stripe",
        lastCompletedAt: new Date(NOW.getTime() - 61 * 60_000),
        stale: true,
      },
    ]);
  });
});

describe("sweepWatchtowerStaleness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapters(["npm:openai", "openapi:stripe"]);
    vi.mocked(prisma.organization.upsert).mockResolvedValue({ id: "org-watchtower" } as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
    vi.mocked(alertDlq).mockResolvedValue(undefined);
  });

  it("stays quiet when every adapter polled recently", async () => {
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValue({
      completedAt: new Date(NOW.getTime() - 5 * 60_000),
    } as never);
    const result = await sweepWatchtowerStaleness({ now: NOW });
    expect(result.stale).toBe(false);
    expect(alertDlq).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it("alerts and audits with the stale adapter set when polling stops", async () => {
    vi.mocked(prisma.detectionRun.findFirst).mockImplementation((async (args: unknown) => {
      const where = (args as { where: { adapter: string } }).where;
      if (where.adapter === "npm:openai") {
        return { completedAt: new Date(NOW.getTime() - 5 * 60_000) };
      }
      return null;
    }) as never);
    const result = await sweepWatchtowerStaleness({ now: NOW });
    expect(result.stale).toBe(true);
    expect(alertDlq).toHaveBeenCalledWith(
      "watchtower-staleness",
      expect.stringContaining("openapi:stripe"),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: AuditAction.WATCHTOWER_STALE }),
      }),
    );
  });

  it("still records the verdict when the alert channel blows up", async () => {
    vi.mocked(prisma.detectionRun.findFirst).mockResolvedValue(null);
    vi.mocked(alertDlq).mockRejectedValue(new Error("webhook down"));
    const result = await sweepWatchtowerStaleness({ now: NOW });
    expect(result.stale).toBe(true);
    expect(prisma.auditEvent.create).toHaveBeenCalled();
  });

  it("lets database failures propagate to the scheduler wrapper (which logs them)", async () => {
    vi.mocked(prisma.detectionRun.findFirst).mockRejectedValue(new Error("db down"));
    await expect(sweepWatchtowerStaleness({ now: NOW })).rejects.toThrow("db down");
  });

  it("skips quietly when no adapters are configured", async () => {
    adapters([]);
    const result = await sweepWatchtowerStaleness({ now: NOW });
    expect(result).toEqual({ stale: false, adapters: [] });
    expect(alertDlq).not.toHaveBeenCalled();
  });
});
