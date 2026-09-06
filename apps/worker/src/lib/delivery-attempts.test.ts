import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  claimDeliveryAttempt,
  classifyDeliveryError,
  completeDeliveryAttempt,
  recordBestEffortAttempt,
} from "./delivery-attempts";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    deliveryAttempt: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const input = {
  organizationId: "org-1",
  remediationPlanId: "plan-1",
  idempotencyKey: "create:abc123",
  action: "CREATE" as const,
};

describe("claimDeliveryAttempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets the first writer through as IN_PROGRESS", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockResolvedValueOnce({ id: "att-1" } as never);
    const outcome = await claimDeliveryAttempt(input);
    expect(outcome).toEqual({ duplicate: false, attemptId: "att-1" });
    expect(prisma.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        idempotencyKey: "create:abc123",
        action: "CREATE",
        status: "IN_PROGRESS",
        attemptCount: 1,
      }),
    });
  });

  it("returns the winner without delivering twice on a retry", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockRejectedValueOnce({ code: "P2002" });
    vi.mocked(prisma.deliveryAttempt.findUnique).mockResolvedValueOnce({
      id: "att-1",
      status: "SUCCEEDED",
      pullRequestId: "pr-1",
      externalId: "42",
      url: "https://github.com/acme/app/pull/42",
    } as never);
    const outcome = await claimDeliveryAttempt(input);
    expect(outcome).toEqual({
      duplicate: true,
      attempt: {
        id: "att-1",
        status: "SUCCEEDED",
        pullRequestId: "pr-1",
        externalId: "42",
        url: "https://github.com/acme/app/pull/42",
      },
    });
  });

  it("throws retryably while another worker holds the key", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockRejectedValueOnce({ code: "P2002" });
    vi.mocked(prisma.deliveryAttempt.findUnique).mockResolvedValueOnce({
      id: "att-1",
      status: "IN_PROGRESS",
    } as never);
    await expect(claimDeliveryAttempt(input)).rejects.toThrow(/already in progress/);
  });

  it("adopts a failed winner with an incremented attempt count", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockRejectedValueOnce({ code: "P2002" });
    vi.mocked(prisma.deliveryAttempt.findUnique).mockResolvedValueOnce({
      id: "att-1",
      status: "FAILED",
      attemptCount: 2,
      pullRequestId: null,
    } as never);
    vi.mocked(prisma.deliveryAttempt.update).mockResolvedValueOnce({ id: "att-1" } as never);
    const outcome = await claimDeliveryAttempt(input);
    expect(outcome).toEqual({ duplicate: false, attemptId: "att-1" });
    expect(prisma.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: "att-1" },
      data: expect.objectContaining({ status: "IN_PROGRESS", attemptCount: 3 }),
    });
  });

  it("throws retryably when the winner vanishes mid-race", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockRejectedValueOnce({ code: "P2002" });
    vi.mocked(prisma.deliveryAttempt.findUnique).mockResolvedValueOnce(null);
    await expect(claimDeliveryAttempt(input)).rejects.toThrow(/without a winner/);
  });

  it("rethrows non-conflict write failures", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockRejectedValueOnce(new Error("db down"));
    await expect(claimDeliveryAttempt(input)).rejects.toThrow("db down");
  });

  it("rejects unclassified actions at the boundary", async () => {
    await expect(claimDeliveryAttempt({ ...input, action: "DELETE" as never })).rejects.toThrow();
    expect(prisma.deliveryAttempt.create).not.toHaveBeenCalled();
  });
});

describe("completeDeliveryAttempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.deliveryAttempt.update).mockResolvedValue({} as never);
  });

  it("writes terminal state with bounded error detail", async () => {
    await completeDeliveryAttempt("att-1", {
      status: "FAILED",
      errorCode: "GITHUB_RATE_LIMITED",
      errorMessage: "x".repeat(5000),
    });
    expect(prisma.deliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: "att-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorCode: "GITHUB_RATE_LIMITED",
        errorMessage: expect.stringMatching(/^x{2000}$/),
      }),
    });
  });
});

describe("recordBestEffortAttempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records check-run and comment attempts directly", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockResolvedValueOnce({ id: "att-9" } as never);
    const result = await recordBestEffortAttempt({
      ...input,
      idempotencyKey: "checkrun:plan-1:abc123",
      action: "CHECK_RUN",
      status: "SUCCEEDED",
      externalId: "777",
    });
    expect(result).toEqual({ recorded: true, attemptId: "att-9" });
  });

  it("skips silently when the identical report already landed", async () => {
    vi.mocked(prisma.deliveryAttempt.create).mockRejectedValueOnce({ code: "P2002" });
    const result = await recordBestEffortAttempt({
      ...input,
      idempotencyKey: "checkrun:plan-1:abc123",
      action: "CHECK_RUN",
      status: "SUCCEEDED",
    });
    expect(result).toEqual({ recorded: false, attemptId: null });
  });
});

describe("classifyDeliveryError", () => {
  it("passes GitHubApiError codes through by name (no cross-bundle instanceof)", () => {
    expect(classifyDeliveryError({ name: "GitHubApiError", code: "GITHUB_RATE_LIMITED" })).toBe(
      "GITHUB_RATE_LIMITED",
    );
    expect(classifyDeliveryError({ name: "GitHubApiError", code: "GITHUB_CONFLICT" })).toBe(
      "GITHUB_CONFLICT",
    );
  });

  it("classifies worker-side failures", () => {
    expect(classifyDeliveryError(new Error("PR creation blocked by policy decision 'DENY'"))).toBe(
      "POLICY_BLOCKED",
    );
    expect(classifyDeliveryError(new Error("maximum concurrent draft PR limit"))).toBe(
      "PR_SLOT_THROTTLED",
    );
    expect(classifyDeliveryError(new Error("PR creation safety unavailable: Redis"))).toBe(
      "PR_SLOT_UNAVAILABLE",
    );
    expect(classifyDeliveryError(new Error("delivery already in progress for k"))).toBe(
      "DELIVERY_IN_PROGRESS",
    );
    expect(classifyDeliveryError(new Error("connector x is not certified for DRAFT_PR"))).toBe(
      "CONNECTOR_UNCERTIFIED",
    );
    expect(classifyDeliveryError(new Error("capability gate is SUSPENDED"))).toBe(
      "CAPABILITY_GATE_CLOSED",
    );
    expect(classifyDeliveryError(new Error("boom"))).toBe("DELIVERY_FAILED");
    expect(classifyDeliveryError("plain string")).toBe("DELIVERY_FAILED");
  });
});
