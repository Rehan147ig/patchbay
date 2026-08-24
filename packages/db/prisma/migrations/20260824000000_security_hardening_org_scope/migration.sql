-- Security hardening bundle:
-- 1. TaskParameter becomes org-scoped (cross-tenant submission fix).
-- 2. WebhookDelivery.payloadHash becomes globally unique (atomic webhook replay dedupe).
-- 3. VendorChangeEvent gains an ingest-idempotency unique constraint
--    (organizationId, vendorId, externalReference); NULLS DISTINCT keeps
--    rows without an external reference unaffected.

-- 1a. TaskParameter.organizationId
ALTER TABLE "TaskParameter" ADD COLUMN "organizationId" TEXT;

-- Backfill legacy rows into the single seeded organization (local-dev MVP).
UPDATE "TaskParameter"
SET "organizationId" = (
  SELECT "id" FROM "Organization" ORDER BY "createdAt" ASC LIMIT 1
)
WHERE "organizationId" IS NULL;

ALTER TABLE "TaskParameter" ALTER COLUMN "organizationId" SET NOT NULL;

-- 1b. Composite identity now includes the organization.
DROP INDEX IF EXISTS "TaskParameter_taskId_type_key";
CREATE UNIQUE INDEX "TaskParameter_organizationId_taskId_type_key"
  ON "TaskParameter"("organizationId", "taskId", "type");

CREATE INDEX "TaskParameter_organizationId_idx" ON "TaskParameter"("organizationId");

-- 1c. Relation to Organization (cascade matches schema.prisma).
ALTER TABLE "TaskParameter"
  ADD CONSTRAINT "TaskParameter_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Atomic webhook replay dedupe.
DROP INDEX IF EXISTS "WebhookDelivery_payloadHash_receivedAt_idx";
CREATE UNIQUE INDEX "WebhookDelivery_payloadHash_key" ON "WebhookDelivery"("payloadHash");

-- 3. Agent-ingest idempotency (M5): one event per external reference per
--    org+vendor. NULLS DISTINCT keeps reference-less events unaffected.
CREATE UNIQUE INDEX "VendorChangeEvent_organizationId_vendorId_externalReference_key"
  ON "VendorChangeEvent"("organizationId", "vendorId", "externalReference");
