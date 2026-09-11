-- P1 webhook intelligence: WEBHOOK_SCHEMA graph node kind for Zod payload
-- validators discovered in webhook/event handler files (packages/repo-analysis
-- collectZodWebhookSchemas). Vocabulary-only change: no tables, no RLS policy
-- changes (GraphNode rows stay org-scoped under the existing tenant policy),
-- no backfill (existing snapshots never emitted this kind).
-- Rollback: new enum values cannot be dropped while rows reference them;
-- delete/refresh affected GraphNode rows first, then recreate the type without
-- the value (standard Postgres enum-maintenance procedure).
ALTER TYPE "GraphNodeKind" ADD VALUE 'WEBHOOK_SCHEMA';
