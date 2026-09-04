import { beforeEach, describe, expect, it, vi } from "vitest";
import { processSiemForward } from "./siem-forward";

vi.mock("@patchbay/db", () => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    auditEvent: { findMany: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@patchbay/db";

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
];

const CONFIG = {
  enabled: true,
  splunkHecUrl: "https://splunk.acme.test:8088/services/collector",
  hecToken: "hec-secret",
  lastForwardedAt: null,
  lastForwardedId: null,
};

function job() {
  return {
    data: { organizationId: "org-acme", correlationId: "corr-1" },
  } as never;
}

describe("processSiemForward", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => '{"text":"Success"}' }),
    );
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: "org-acme",
      auditExportConfig: CONFIG,
    } as never);
    vi.mocked(prisma.auditEvent.findMany).mockResolvedValue(EVENTS as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
  });

  it("ships a Splunk HEC batch and advances the cursor only on success", async () => {
    const result = await processSiemForward(job());
    expect(result).toMatchObject({ organizationId: "org-acme", forwarded: 1, skipped: false });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://splunk.acme.test:8088/services/collector",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Splunk hec-secret" }),
      }),
    );
    const sent = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body.split("\n")[0]!,
    ) as { time: number; source: string; event: { id: string } };
    expect(sent).toMatchObject({ source: "patchbay", event: { id: "evt-1" } });

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-acme" },
        data: expect.objectContaining({
          auditExportConfig: expect.objectContaining({
            lastForwardedAt: "2026-09-03T00:00:00.000Z",
            lastForwardedId: "evt-1",
          }),
        }),
      }),
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "siem.batch_forwarded" }),
      }),
    );
  });

  it("skips silently when forwarding is not configured", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: "org-acme",
      auditExportConfig: { enabled: false },
    } as never);
    const result = await processSiemForward(job());
    expect(result).toMatchObject({ forwarded: 0, skipped: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("throws without advancing the cursor when the HEC rejects the batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" }),
    );
    await expect(processSiemForward(job())).rejects.toThrow("SIEM forward rejected: 403");
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});
