-- WP4 case orchestration: bridge RemediationCase to contract changes, extend
-- ImpactAssessment for contract-driven rows, and add RemediationAttempt.
--
-- All added columns are nullable or defaulted: existing release-funnel rows
-- need no backfill. releaseId/dependencyId/changeEventId relax to nullable so
-- contract-driven rows (which link via contractChangeId/caseId instead) are
-- representable; the release funnel keeps writing them on every row.
-- dedupeKey uniqueness is a plain unique constraint (NULL legacy rows never
-- conflict under NULLS DISTINCT, matching the VendorChangeEvent precedent).

ALTER TABLE "RemediationCase" ADD COLUMN "contractChangeId" TEXT;
ALTER TABLE "RemediationCase" ADD COLUMN "caseKey" TEXT;
ALTER TABLE "RemediationCase" ADD COLUMN "triggerType" TEXT;
ALTER TABLE "RemediationCase" ADD COLUMN "dedupeKey" TEXT;
ALTER TABLE "RemediationCase" ALTER COLUMN "releaseId" DROP NOT NULL;
ALTER TABLE "RemediationCase" ALTER COLUMN "dependencyId" DROP NOT NULL;

CREATE UNIQUE INDEX "RemediationCase_organizationId_dedupeKey_key"
  ON "RemediationCase"("organizationId", "dedupeKey");
CREATE INDEX "RemediationCase_org_contractChange_idx"
  ON "RemediationCase"("organizationId", "contractChangeId");

ALTER TABLE "RemediationCase" ADD CONSTRAINT "RemediationCase_contractChangeId_fkey"
  FOREIGN KEY ("contractChangeId") REFERENCES "ContractChange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImpactAssessment" ADD COLUMN "caseId" TEXT;
ALTER TABLE "ImpactAssessment" ADD COLUMN "graphSnapshotId" TEXT;
ALTER TABLE "ImpactAssessment" ADD COLUMN "affected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ImpactAssessment" ADD COLUMN "blastRadiusJson" JSONB;
ALTER TABLE "ImpactAssessment" ADD COLUMN "evidenceJson" JSONB;
ALTER TABLE "ImpactAssessment" ADD COLUMN "reasonCode" TEXT;
ALTER TABLE "ImpactAssessment" ALTER COLUMN "changeEventId" DROP NOT NULL;

ALTER TABLE "ImpactAssessment" ADD CONSTRAINT "ImpactAssessment_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "RemediationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImpactAssessment" ADD CONSTRAINT "ImpactAssessment_graphSnapshotId_fkey"
  FOREIGN KEY ("graphSnapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ImpactAssessment_case_repository_key"
  ON "ImpactAssessment"("caseId", "repositoryId");
CREATE INDEX "ImpactAssessment_case_idx" ON "ImpactAssessment"("caseId");
CREATE UNIQUE INDEX "ImpactAssessment_caseId_repositoryId_key"
  ON "ImpactAssessment"("caseId", "repositoryId");

CREATE TABLE "RemediationAttempt" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "strategyId" TEXT NOT NULL,
  "rulePackVersion" TEXT,
  "agentRunId" TEXT,
  "inputHash" TEXT NOT NULL,
  "outputHash" TEXT,
  "status" TEXT NOT NULL,
  "patchArtifactId" TEXT,
  "failureCode" TEXT,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RemediationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RemediationAttempt_org_case_created_idx"
  ON "RemediationAttempt"("organizationId", "caseId", "createdAt");
CREATE INDEX "RemediationAttempt_case_strategy_idx"
  ON "RemediationAttempt"("caseId", "strategyId");

ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "RemediationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_patchArtifactId_fkey"
  FOREIGN KEY ("patchArtifactId") REFERENCES "PatchArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: the policy covers every row).
ALTER TABLE "RemediationAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RemediationAttempt" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RemediationAttempt_tenant_isolation" ON "RemediationAttempt";
CREATE POLICY "RemediationAttempt_tenant_isolation" ON "RemediationAttempt"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
