import { ActorType, type ActorType as ActorTypeValue } from "@patchbay/domain";
import { AuditAction, type AuditAction as AuditActionValue } from "./actions";
import { redactSecrets } from "./redact";

export interface AuditEventInput {
  organizationId: string;
  actorType: ActorTypeValue;
  actorId: string | null;
  action: AuditActionValue;
  entityType: string;
  entityId?: string | null;
  correlationId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface AuditEventRecord extends AuditEventInput {
  id: string;
  beforeJson: unknown | null;
  afterJson: unknown | null;
  createdAt: Date;
}

const AUDIT_ACTOR_TYPES = new Set<string>(Object.values(ActorType));
const AUDIT_ACTIONS = new Set<string>(Object.values(AuditAction));

/**
 * Builds a normalized AuditEvent record ready for persistence. Redaction happens here so no
 * caller can accidentally persist secrets.
 */
export function buildAuditEvent(input: AuditEventInput): AuditEventRecord {
  if (!AUDIT_ACTOR_TYPES.has(input.actorType)) {
    throw new Error(`Unknown audit actorType: ${input.actorType}`);
  }
  if (!AUDIT_ACTIONS.has(input.action)) {
    throw new Error(`Unknown audit action: ${input.action}`);
  }

  return {
    id: randomId(),
    organizationId: input.organizationId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    correlationId: input.correlationId ?? null,
    beforeJson: input.before === undefined ? null : redactSecrets(input.before),
    afterJson: input.after === undefined ? null : redactSecrets(input.after),
    metadata: input.metadata ? (redactSecrets(input.metadata) as Record<string, unknown>) : null,
    createdAt: new Date(),
  };
}

function randomId(): string {
  return crypto.randomUUID();
}
