import { describe, expect, it } from "vitest";
import {
  cefSeverityForAction,
  formatAuditCef,
  formatAuditJsonl,
  normalizeAuditEvent,
  type ExportableAuditEvent,
} from "./export";

const BASE_EVENT: ExportableAuditEvent = {
  id: "evt-1",
  organizationId: "org-acme",
  actorType: "USER",
  actorId: "u-1",
  action: "scan.completed",
  entityType: "repository",
  entityId: "repo-1",
  correlationId: "corr-1",
  beforeJson: null,
  afterJson: { usageCount: 12 },
  createdAt: new Date("2026-09-04T00:00:00.000Z"),
};

describe("normalizeAuditEvent", () => {
  it("emits ISO-8601 timestamps and redacts secrets in payloads", () => {
    const normalized = normalizeAuditEvent({
      ...BASE_EVENT,
      afterJson: { apiKey: "sk-live-secret-value", usageCount: 3 },
      beforeJson: { note: "Bearer abcdefghijklmnop" },
    });
    expect(normalized.timestamp).toBe("2026-09-04T00:00:00.000Z");
    expect(normalized.after).toEqual({ apiKey: "[REDACTED]", usageCount: 3 });
    expect(normalized.before).toEqual({ note: "[REDACTED]" });
  });

  it("accepts string timestamps", () => {
    const normalized = normalizeAuditEvent({ ...BASE_EVENT, createdAt: "2026-09-04T00:00:00Z" });
    expect(normalized.timestamp).toBe("2026-09-04T00:00:00.000Z");
  });
});

describe("formatAuditJsonl", () => {
  it("emits one parseable JSON object per line with all required fields", () => {
    const line = formatAuditJsonl(BASE_EVENT);
    expect(line.includes("\n")).toBe(false);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    for (const field of [
      "id",
      "timestamp",
      "organizationId",
      "actorType",
      "actorId",
      "action",
      "entityType",
      "entityId",
      "correlationId",
      "before",
      "after",
    ]) {
      expect(parsed).toHaveProperty(field);
    }
    expect(parsed.id).toBe("evt-1");
  });
});

describe("cefSeverityForAction", () => {
  it("maps identity, approval, and policy actions to High", () => {
    expect(cefSeverityForAction("scim.user_deprovisioned")).toBe(7);
    expect(cefSeverityForAction("approval.recorded")).toBe(7);
    expect(cefSeverityForAction("capability.gate_suspended")).toBe(7);
  });

  it("maps routine scan progress to Low and everything else to Medium", () => {
    expect(cefSeverityForAction("scan.completed")).toBe(2);
    expect(cefSeverityForAction("plan.created")).toBe(5);
    expect(cefSeverityForAction("something.unknown")).toBe(5);
  });
});

describe("formatAuditCef", () => {
  it("follows the CEF header layout with severity and extensions", () => {
    const line = formatAuditCef(BASE_EVENT);
    expect(line.startsWith("CEF:0|Patchbay|Autonomous Remediation Engine|1.0|")).toBe(true);
    expect(line).toContain("scan.completed|scan.completed|2|");
    expect(line).toContain("cs1Label=correlationId cs1=corr-1");
    expect(line).toContain("suser=u-1");
    expect(line).toContain("act=scan.completed");
  });

  it("escapes pipes, equals, and newlines per the spec", () => {
    const line = formatAuditCef({
      ...BASE_EVENT,
      action: "plan.created|evil",
      correlationId: "a=b\nc",
    });
    expect(line).toContain("plan.created\\|evil");
    expect(line).toContain("cs1=a\\=b\\nc");
    expect(line.includes("\n")).toBe(false);
  });
});
