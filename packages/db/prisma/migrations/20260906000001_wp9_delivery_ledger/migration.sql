-- WP9 delivery reliability (spec §19/§12): DeliveryAttempt idempotency
-- ledger. The unique idempotency key makes the first writer win; retries
-- adopt or observe the winner instead of delivering twice (zero duplicate
-- PRs across BullMQ retries and worker crashes).

CREATE TABLE "DeliveryAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "remediationPlanId" TEXT NOT NULL,
  "pullRequestId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "externalId" TEXT,
  "url" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryAttempt_idempotencyKey_key" ON "DeliveryAttempt"("idempotencyKey");
CREATE INDEX "DeliveryAttempt_org_idx" ON "DeliveryAttempt"("organizationId");
CREATE INDEX "DeliveryAttempt_plan_idx" ON "DeliveryAttempt"("remediationPlanId");
CREATE INDEX "DeliveryAttempt_status_idx" ON "DeliveryAttempt"("status");

ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_remediationPlanId_fkey"
  FOREIGN KEY ("remediationPlanId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_pullRequestId_fkey"
  FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: the policy covers every row).
ALTER TABLE "DeliveryAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryAttempt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "DeliveryAttempt_tenant_isolation" ON "DeliveryAttempt";
CREATE POLICY "DeliveryAttempt_tenant_isolation" ON "DeliveryAttempt"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
