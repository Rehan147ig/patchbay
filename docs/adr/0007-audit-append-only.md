# ADR-0007: Application-level append-only audit trail

Status: accepted

## Context

Every important action must be auditable, and the trail must be tamper-resistant at the
application layer for an MVP.

## Decision

- All mutations write an `AuditEvent` (org, actorType, actorId, action, entityType, entityId,
  correlationId, beforeJson, afterJson, metadata, createdAt).
- There are no update/delete code paths for AuditEvent anywhere; UI and API expose it read-only.
- Before/after JSON snapshots are redacted via `packages/audit`'s `redactSecrets` before persist.

## Consequences

- Accountability and replayability for all remediations and policy decisions.
- True immutability (WORM storage, DB permissions) is a documented production requirement
  (threat T8).
