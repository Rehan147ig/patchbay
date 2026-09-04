import { redactSecrets } from "./redact";

/**
 * SIEM export formatters (JSONL + CEF). Pure and deterministic: same event in,
 * byte-identical line out. Secrets in before/after payloads pass through
 * redactSecrets() so exports never leak credential material even when a
 * caller bypasses the write-time redaction in event.ts.
 */

export interface ExportableAuditEvent {
  id: string;
  organizationId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string | null;
  beforeJson: unknown | null;
  afterJson: unknown | null;
  createdAt: Date | string;
}

export interface NormalizedAuditEvent {
  id: string;
  timestamp: string;
  organizationId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string | null;
  before: unknown | null;
  after: unknown | null;
}

export function normalizeAuditEvent(event: ExportableAuditEvent): NormalizedAuditEvent {
  const createdAt = event.createdAt instanceof Date ? event.createdAt : new Date(event.createdAt);
  return {
    id: event.id,
    timestamp: createdAt.toISOString(),
    organizationId: event.organizationId,
    actorType: event.actorType,
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    correlationId: event.correlationId,
    before: redactSecrets(event.beforeJson),
    after: redactSecrets(event.afterJson),
  };
}

/** One valid JSON object per line (JSON Lines). */
export function formatAuditJsonl(event: ExportableAuditEvent): string {
  return JSON.stringify(normalizeAuditEvent(event));
}

/**
 * CEF severity by action family (0-10 scale). Approvals, policy denials,
 * capability changes, and identity events are High; routine scan/index
 * progress is Low; everything else is Medium.
 */
const HIGH_SEVERITY_ACTIONS = new Set([
  "approval.recorded",
  "policy.blocked",
  "policy.decision",
  "capability.gate_changed",
  "capability.gate_suspended",
  "scim.user_created",
  "scim.user_deprovisioned",
  "scim.token_issued",
  "scim.token_revoked",
  "user.login",
  "data.exported",
  "data.deleted",
  "agent.run_purged",
  "pr.failed",
]);

const LOW_SEVERITY_ACTIONS = new Set([
  "scan.queued",
  "scan.started",
  "scan.completed",
  "graph.index_queued",
  "notification.created",
  "notification.marked_read",
  "pr.outcome_recorded",
  "pr.outcome_classified",
]);

export function cefSeverityForAction(action: string): number {
  if (HIGH_SEVERITY_ACTIONS.has(action)) return 7;
  if (LOW_SEVERITY_ACTIONS.has(action)) return 2;
  return 5;
}

/** Escapes CEF header pipes/backslashes per the ArcSight spec. */
function escapeCefHeader(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/** Escapes CEF extension values (= and \ and CR/LF). */
function escapeCefExtension(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/=/g, "\\=")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function summarizeEvent(event: NormalizedAuditEvent): string {
  const target = event.entityId ? `${event.entityType} ${event.entityId}` : event.entityType;
  return `${event.action} on ${target}`;
}

/**
 * ArcSight Common Event Format:
 * CEF:0|Patchbay|Autonomous Remediation Engine|1.0|<action>|<action>|<sev>|...
 */
export function formatAuditCef(event: ExportableAuditEvent): string {
  const normalized = normalizeAuditEvent(event);
  const severity = cefSeverityForAction(normalized.action);
  const header = [
    "CEF:0",
    "Patchbay",
    "Autonomous Remediation Engine",
    "1.0",
    escapeCefHeader(normalized.action),
    escapeCefHeader(normalized.action),
    String(severity),
  ].join("|");
  const extensions = [
    `cs1Label=correlationId cs1=${escapeCefExtension(normalized.correlationId ?? "")}`,
    `suser=${escapeCefExtension(normalized.actorId ?? "")}`,
    `src=${escapeCefExtension(normalized.actorType)}`,
    `act=${escapeCefExtension(normalized.action)}`,
    `msg=${escapeCefExtension(summarizeEvent(normalized))}`,
  ].join(" ");
  return `${header}|${extensions}`;
}
