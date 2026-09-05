import { describe, expect, it, vi } from "vitest";
import { AuditAction } from "@patchbay/audit";
import {
  failedJobInfoFrom,
  handlePermanentlyFailedJob,
  type FailedJobInfo,
  type JobFailureDeps,
} from "./job-failure";

function deps(): JobFailureDeps & {
  alert: ReturnType<typeof vi.fn>;
  enqueueDlq: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
  systemOrg: ReturnType<typeof vi.fn>;
} {
  return {
    alert: vi.fn().mockResolvedValue(undefined),
    enqueueDlq: vi.fn().mockResolvedValue({ id: "dlq-1" }),
    audit: vi.fn().mockResolvedValue(undefined),
    systemOrg: vi.fn().mockResolvedValue("org-watchtower"),
  };
}

const exhausted: FailedJobInfo = {
  jobType: "create-pr",
  jobId: "job-1",
  organizationId: "org-1",
  correlationId: "corr-1",
  attemptsMade: 3,
  attemptsAllowed: 3,
};

describe("failedJobInfoFrom", () => {
  it("extracts org/correlation ids and attempt counts defensively", () => {
    const info = failedJobInfoFrom({
      name: "scan-repository",
      id: "job-9",
      data: { organizationId: "org-9", correlationId: "corr-9" },
      attemptsMade: 2,
      opts: { attempts: 3 },
    } as never);
    expect(info).toMatchObject({
      jobType: "scan-repository",
      jobId: "job-9",
      organizationId: "org-9",
      correlationId: "corr-9",
      attemptsMade: 2,
      attemptsAllowed: 3,
    });
  });

  it("survives an undefined job", () => {
    expect(failedJobInfoFrom(undefined)).toMatchObject({ jobType: "unknown" });
  });
});

describe("handlePermanentlyFailedJob", () => {
  it("ignores transient attempts so retries never spam the alert channel", async () => {
    const d = deps();
    await handlePermanentlyFailedJob({ ...exhausted, attemptsMade: 1 }, new Error("boom"), d);
    expect(d.alert).not.toHaveBeenCalled();
    expect(d.enqueueDlq).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it("alerts, DLQs, and audits an exhausted job against its own org", async () => {
    const d = deps();
    await handlePermanentlyFailedJob(exhausted, new Error("boom"), d);
    expect(d.alert).toHaveBeenCalledWith("create-pr", expect.stringContaining("boom"));
    expect(d.enqueueDlq).toHaveBeenCalledWith(
      "create-pr",
      expect.objectContaining({ jobId: "job-1", attemptsMade: 3 }),
    );
    expect(d.systemOrg).not.toHaveBeenCalled();
    expect(d.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        action: AuditAction.JOB_PERMANENTLY_FAILED,
        entityType: "job",
        entityId: "job-1",
      }),
    );
  });

  it("falls back to the system org for global jobs without an organization", async () => {
    const d = deps();
    await handlePermanentlyFailedJob(
      { ...exhausted, organizationId: undefined },
      new Error("boom"),
      d,
    );
    expect(d.systemOrg).toHaveBeenCalled();
    expect(d.audit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-watchtower" }),
    );
  });

  it("redacts secret-looking values before they reach alerts or audit", async () => {
    const d = deps();
    // Built programmatically: a literal ghp_* token in source trips the
    // gitleaks github-pat rule (false positive on a synthetic test secret).
    // 24 chars still exercises the app redactor (threshold is 20).
    const fakePat = `ghp_${"abcdefghij1234567890abcd"}`;
    await handlePermanentlyFailedJob(exhausted, new Error(`failed with key ${fakePat}`), d);
    const alerted = String(d.alert.mock.calls[0]?.[1] ?? "");
    expect(alerted).not.toContain(fakePat);
    expect(alerted).toContain("[REDACTED]");
  });

  it("never throws when alert, DLQ, or audit blow up", async () => {
    const d = deps();
    d.alert.mockRejectedValue(new Error("webhook down"));
    d.enqueueDlq.mockRejectedValue(new Error("redis down"));
    d.audit.mockRejectedValue(new Error("db down"));
    await expect(handlePermanentlyFailedJob(exhausted, new Error("boom"), d)).resolves.toBe(
      undefined,
    );
  });
});
