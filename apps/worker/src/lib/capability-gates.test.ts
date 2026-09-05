import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertWorkerCapabilityGateOpen } from "./capability-gates";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    capabilityGate: { findUnique: vi.fn() },
  },
}));

describe("assertWorkerCapabilityGateOpen (WP5 worker twin of the web gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when no gate row exists (open by default)", async () => {
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue(null);
    await expect(
      assertWorkerCapabilityGateOpen("org-1", "openai", "DRAFT_PR"),
    ).resolves.toBeUndefined();
  });

  it("passes when the gate is ACTIVE", async () => {
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue({ status: "ACTIVE" } as never);
    await expect(
      assertWorkerCapabilityGateOpen("org-1", "openai", "DRAFT_PR"),
    ).resolves.toBeUndefined();
  });

  it("throws loudly on SUSPENDED with the same message shape as the web twin", async () => {
    vi.mocked(prisma.capabilityGate.findUnique).mockResolvedValue({
      status: "SUSPENDED",
      reason: "merge rate below threshold",
    } as never);
    await expect(assertWorkerCapabilityGateOpen("org-1", "openai", "DRAFT_PR")).rejects.toThrow(
      "Capability openai@DRAFT_PR is suspended: merge rate below threshold",
    );
  });
});
