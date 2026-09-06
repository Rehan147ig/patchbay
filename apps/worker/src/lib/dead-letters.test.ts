import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  deadLetterKey,
  deadLetterPayloadHash,
  recordDeadLetterJob,
  redactPayload,
} from "./dead-letters";
import { prisma } from "@patchbay/db";

vi.mock("@patchbay/db", () => ({
  prisma: {
    deadLetterJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const input = {
  organizationId: "org-1",
  jobType: "create-pr",
  jobId: "job-1",
  payload: { remediationPlanId: "plan-1", organizationId: "org-1" },
  errorCode: "GITHUB_RATE_LIMITED",
  errorMessage: "slow down",
  attemptsMade: 3,
  correlationId: "corr-1",
};

describe("redactPayload", () => {
  it("scrubs secret-looking values while keeping structure", () => {
    const fakePat = `ghp_${"abcdefghij1234567890abcd"}`;
    const redacted = redactPayload({ token: fakePat, nested: { id: "x" } });
    expect(JSON.stringify(redacted)).not.toContain(fakePat);
    expect(JSON.stringify(redacted)).toContain("[REDACTED]");
    expect((redacted.nested as { id: string }).id).toBe("x");
  });

  it("survives unserializable payloads", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(redactPayload(circular)).toEqual({ unserializablePayload: true });
  });
});

describe("deadLetterKey", () => {
  it("prefers the BullMQ id and falls back to the payload hash", () => {
    expect(deadLetterKey("create-pr", "job-1", "abc")).toBe("dlq:create-pr:job-1");
    expect(deadLetterKey("create-pr", null, "abcdef1234567890")).toBe(
      "dlq:create-pr:abcdef1234567890".slice(0, "dlq:create-pr:".length + 16),
    );
  });

  it("hashes stably", () => {
    expect(deadLetterPayloadHash({ b: 1, a: 2 })).toBe(deadLetterPayloadHash({ a: 2, b: 1 }));
    expect(deadLetterPayloadHash({ a: 1 })).toHaveLength(64);
  });
});

describe("recordDeadLetterJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an OPEN row with redacted payload and hash", async () => {
    vi.mocked(prisma.deadLetterJob.create).mockResolvedValueOnce({ id: "dead-1" } as never);
    const result = await recordDeadLetterJob(input);
    expect(result).toEqual({ id: "dead-1", created: true });
    expect(prisma.deadLetterJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        jobType: "create-pr",
        jobId: "job-1",
        idempotencyKey: "dlq:create-pr:job-1",
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        errorCode: "GITHUB_RATE_LIMITED",
        attemptsMade: 3,
        status: "OPEN",
      }),
    });
  });

  it("refreshes the winner instead of duplicating on conflict", async () => {
    vi.mocked(prisma.deadLetterJob.create).mockRejectedValueOnce({ code: "P2002" });
    vi.mocked(prisma.deadLetterJob.findUnique).mockResolvedValueOnce({ id: "dead-1" } as never);
    vi.mocked(prisma.deadLetterJob.update).mockResolvedValueOnce({ id: "dead-1" } as never);
    const result = await recordDeadLetterJob(input);
    expect(result).toEqual({ id: "dead-1", created: false });
    expect(prisma.deadLetterJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "dead-1" } }),
    );
  });

  it("throws retryably when the winner vanishes mid-race", async () => {
    vi.mocked(prisma.deadLetterJob.create).mockRejectedValueOnce({ code: "P2002" });
    vi.mocked(prisma.deadLetterJob.findUnique).mockResolvedValueOnce(null);
    await expect(recordDeadLetterJob(input)).rejects.toThrow(/without a winner/);
  });

  it("bounds the stored error message", async () => {
    vi.mocked(prisma.deadLetterJob.create).mockResolvedValueOnce({ id: "dead-1" } as never);
    await recordDeadLetterJob({ ...input, errorMessage: "x".repeat(5000) });
    expect(prisma.deadLetterJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ errorMessage: "x".repeat(2000) }),
    });
  });
});
