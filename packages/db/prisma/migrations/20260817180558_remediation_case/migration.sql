-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OBSERVED', 'EVIDENCE_VERIFIED', 'IMPACT_CONFIRMED', 'POLICY_ELIGIBLE', 'PLANNING', 'PATCH_PROPOSED', 'VALIDATING', 'APPROVAL_REQUIRED', 'DRAFT_PR_CREATED', 'PLAN_ONLY', 'REJECTED', 'CANCELLED', 'MERGED', 'CLOSED', 'LEARNED');

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "remediationCaseId" TEXT;

-- AlterTable
ALTER TABLE "RemediationPlan" ADD COLUMN     "remediationCaseId" TEXT;

-- CreateTable
CREATE TABLE "RemediationCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'OBSERVED',
    "reasonCode" TEXT NOT NULL,
    "blastRadius" JSONB,
    "policyDecision" JSONB,
    "capabilityLevel" TEXT NOT NULL,
    "validationProfile" TEXT,
    "snapshotId" TEXT,
    "ownerUserId" TEXT,
    "terminalOutcome" TEXT,
    "terminalAt" TIMESTAMP(3),
    "releaseId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,
    "releaseRepositoryMatchId" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemediationCaseEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "remediationCaseId" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL,
    "reasonCode" TEXT,
    "detailJson" JSONB,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemediationCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemediationCase_organizationId_status_updatedAt_idx" ON "RemediationCase"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "RemediationCase_organizationId_releaseId_idx" ON "RemediationCase"("organizationId", "releaseId");

-- CreateIndex
CREATE INDEX "RemediationCase_organizationId_repositoryId_status_idx" ON "RemediationCase"("organizationId", "repositoryId", "status");

-- CreateIndex
CREATE INDEX "RemediationCase_releaseId_repositoryId_dependencyId_idx" ON "RemediationCase"("releaseId", "repositoryId", "dependencyId");

-- CreateIndex
CREATE UNIQUE INDEX "RemediationCase_scopeKey_key" ON "RemediationCase"("scopeKey");

-- CreateIndex
CREATE INDEX "RemediationCaseEvent_remediationCaseId_createdAt_idx" ON "RemediationCaseEvent"("remediationCaseId", "createdAt");

-- AddForeignKey
ALTER TABLE "RemediationCase" ADD CONSTRAINT "RemediationCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationCase" ADD CONSTRAINT "RemediationCase_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ReleaseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationCase" ADD CONSTRAINT "RemediationCase_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationCase" ADD CONSTRAINT "RemediationCase_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "RepositoryDependency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationCase" ADD CONSTRAINT "RemediationCase_releaseRepositoryMatchId_fkey" FOREIGN KEY ("releaseRepositoryMatchId") REFERENCES "ReleaseRepositoryMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationCase" ADD CONSTRAINT "RemediationCase_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationCaseEvent" ADD CONSTRAINT "RemediationCaseEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationCaseEvent" ADD CONSTRAINT "RemediationCaseEvent_remediationCaseId_fkey" FOREIGN KEY ("remediationCaseId") REFERENCES "RemediationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_remediationCaseId_fkey" FOREIGN KEY ("remediationCaseId") REFERENCES "RemediationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_remediationCaseId_fkey" FOREIGN KEY ("remediationCaseId") REFERENCES "RemediationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
