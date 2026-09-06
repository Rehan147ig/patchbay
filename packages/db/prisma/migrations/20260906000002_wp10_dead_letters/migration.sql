-- WP10 operations (spec §19/§10): DeadLetterJob persistent dead-letter
-- record. The BullMQ DLQ queue carries the payload for transport; this table
-- is the queryable system of record with redacted payloads, classified error
-- codes, and replay state. The unique idempotency key makes the first writer
-- win; a repeated terminal failure refreshes the row.

CREATE TABLE "DeadLetterJob" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "jobId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "attemptsMade" INTEGER NOT NULL,
  "correlationId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "replayedAt" TIMESTAMP(3),
  "replayJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeadLetterJob_idempotencyKey_key" ON "DeadLetterJob"("idempotencyKey");
CREATE INDEX "DeadLetterJob_org_idx" ON "DeadLetterJob"("organizationId");
CREATE INDEX "DeadLetterJob_status_idx" ON "DeadLetterJob"("status");
CREATE INDEX "DeadLetterJob_jobType_idx" ON "DeadLetterJob"("jobType");

ALTER TABLE "DeadLetterJob" ADD CONSTRAINT "DeadLetterJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: the policy covers every row).
ALTER TABLE "DeadLetterJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeadLetterJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "DeadLetterJob_tenant_isolation" ON "DeadLetterJob";
CREATE POLICY "DeadLetterJob_tenant_isolation" ON "DeadLetterJob"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
