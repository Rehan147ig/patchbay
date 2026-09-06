-- WP5 policy + certification hardening: PolicyDecision enum alignment (§8.1),
-- PolicyDecisionRecord, ConnectorCertification.
--
-- ALTER TYPE RENAME VALUE is transaction-safe (unlike ADD VALUE); the ADDs
-- follow the repo's established enum-extension pattern (WP1/WP3 migrations
-- applied cleanly through the same path).

ALTER TYPE "PolicyDecision" RENAME VALUE 'ALLOW_PLAN_ONLY' TO 'PLAN_ONLY';
ALTER TYPE "PolicyDecision" ADD VALUE IF NOT EXISTS 'ASSESS';
ALTER TYPE "PolicyDecision" ADD VALUE IF NOT EXISTS 'SUPPRESSED';

CREATE TABLE "PolicyDecisionRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT,
  "policyId" TEXT,
  "decision" TEXT NOT NULL,
  "reasonCodes" JSONB,
  "riskTags" JSONB,
  "confidence" INTEGER,
  "policyVersion" TEXT,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatorVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PolicyDecisionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PolicyDecisionRecord_org_case_created_idx"
  ON "PolicyDecisionRecord"("organizationId", "caseId", "createdAt");
CREATE INDEX "PolicyDecisionRecord_case_idx" ON "PolicyDecisionRecord"("caseId");

ALTER TABLE "PolicyDecisionRecord" ADD CONSTRAINT "PolicyDecisionRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyDecisionRecord" ADD CONSTRAINT "PolicyDecisionRecord_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "RemediationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyDecisionRecord" ADD CONSTRAINT "PolicyDecisionRecord_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: the policy covers every row).
ALTER TABLE "PolicyDecisionRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolicyDecisionRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PolicyDecisionRecord_tenant_isolation" ON "PolicyDecisionRecord";
CREATE POLICY "PolicyDecisionRecord_tenant_isolation" ON "PolicyDecisionRecord"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

CREATE TABLE "ConnectorCertification" (
  "id" TEXT NOT NULL,
  "connectorSlug" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "corpusVersion" TEXT,
  "precision" FLOAT,
  "patchSuccessRate" FLOAT,
  "validationSuccessRate" FLOAT,
  "status" TEXT NOT NULL DEFAULT 'CERTIFIED',
  "approvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConnectorCertification_pkey" PRIMARY KEY ("id")
);

-- Global catalog mirror (no organizationId): readable by every tenant, written
-- only by the certification sync. Deliberately no RLS — same rationale as the
-- shared Vendor catalog rows (hiding it per-tenant would break certification
-- checks for everyone).
CREATE UNIQUE INDEX "ConnectorCertification_connector_version_key"
  ON "ConnectorCertification"("connectorSlug", "version");
CREATE INDEX "ConnectorCertification_connector_status_idx"
  ON "ConnectorCertification"("connectorSlug", "status");
