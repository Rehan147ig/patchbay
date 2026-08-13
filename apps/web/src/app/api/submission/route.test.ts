import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { unauthorized } from "@patchbay/domain";
import { POST } from "./route";

vi.mock("@patchbay/db", () => ({
  submitTaskParameter: vi.fn(),
  prisma: { auditEvent: { create: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));

vi.mock("@patchbay/queue", () => ({
  JobType: { UPDATE_TASK_PARAMETER: "update-task-parameter" },
  enqueue: vi.fn(),
}));

import { submitTaskParameter } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { enqueue } from "@patchbay/queue";

const memberUser = { id: "u-member", organizationId: "org-acme" };

const CSRF_TOKEN = "test-csrf-token";
const csrfHeaders = { Cookie: `pb_csrf=${CSRF_TOKEN}`, "x-csrf-token": CSRF_TOKEN };

function request(body: unknown): NextRequest {
  return new Request("http://localhost/api/submission", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeaders },
    body: JSON.stringify(body),
  }) as NextRequest;
}

const submissionBody = {
  taskId: "npm:openai@latest",
  type: "PRODUCT_UPDATE",
  domain: "NPM",
  input: { packageName: "openai" },
};

describe("POST /api/submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireRole).mockResolvedValue(memberUser as never);
    vi.mocked(submitTaskParameter).mockResolvedValue({
      taskParameter: {
        id: "tp-1",
        taskId: submissionBody.taskId,
        type: submissionBody.type,
        domain: "NPM",
        status: "PENDING",
        error: null,
        inputJson: { packageName: "openai" },
        outputJson: null,
        deadline: null,
        startedAt: new Date(),
        createdAt: new Date(),
      },
      created: true,
      refreshed: false,
      reclaimed: false,
      queued: true,
    });
  });

  it("creates a PENDING task parameter, enqueues the daemon job, and audits it", async () => {
    const response = await POST(request(submissionBody));
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      data: { taskId: string; status: string; queued: boolean };
    };
    expect(body.data.taskId).toBe("npm:openai@latest");
    expect(body.data.status).toBe("PENDING");
    expect(body.data.queued).toBe(true);

    expect(submitTaskParameter).toHaveBeenCalledWith({
      taskId: submissionBody.taskId,
      type: submissionBody.type,
      domain: "NPM",
      input: { packageName: "openai" },
      deadline: undefined,
    });
    expect(enqueue).toHaveBeenCalledWith("update-task-parameter", {
      taskId: "npm:openai@latest",
      type: "PRODUCT_UPDATE",
      domain: "NPM",
      organizationId: "org-acme",
      correlationId: expect.any(String),
    });
  });

  it("deduplicates a resubmission of a completed task without re-enqueueing", async () => {
    vi.mocked(submitTaskParameter).mockResolvedValueOnce({
      taskParameter: {
        id: "tp-1",
        taskId: submissionBody.taskId,
        type: submissionBody.type,
        domain: "NPM",
        status: "COMPLETED",
        error: null,
        inputJson: {},
        outputJson: null,
        deadline: null,
        startedAt: new Date(),
        createdAt: new Date(),
      },
      created: false,
      refreshed: false,
      reclaimed: false,
      queued: false,
    });

    const response = await POST(request(submissionBody));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { status: string; queued: boolean; deduplicated: boolean };
    };
    expect(body.data.status).toBe("COMPLETED");
    expect(body.data.queued).toBe(false);
    expect(body.data.deduplicated).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("resets a failed task to PENDING on retry and re-enqueues it", async () => {
    vi.mocked(submitTaskParameter).mockResolvedValueOnce({
      taskParameter: {
        id: "tp-1",
        taskId: submissionBody.taskId,
        type: submissionBody.type,
        domain: "NPM",
        status: "PENDING",
        error: null,
        inputJson: {},
        outputJson: null,
        deadline: null,
        startedAt: new Date(),
        createdAt: new Date(),
      },
      created: false,
      refreshed: true,
      reclaimed: false,
      queued: true,
    });

    const response = await POST(request(submissionBody));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { status: string; queued: boolean; deduplicated: boolean };
    };
    expect(body.data.status).toBe("PENDING");
    expect(body.data.queued).toBe(true);
    expect(body.data.deduplicated).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid submission payload with 422", async () => {
    const response = await POST(
      request({ taskId: "npm:openai@latest", type: "PRODUCT_UPDATE", domain: "UNKNOWN_DOMAIN" }),
    );
    expect(response.status).toBe(422);
    expect(submitTaskParameter).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers with 401", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(unauthorized("Authentication required"));
    const response = await POST(request(submissionBody));
    expect(response.status).toBe(401);
    expect(submitTaskParameter).not.toHaveBeenCalled();
  });
});
