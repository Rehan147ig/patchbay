-- CreateEnum
CREATE TYPE "PrOutcomeStatus" AS ENUM ('OPEN', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PrOutcomeClassification" AS ENUM ('SUCCESS', 'WRONG_IMPACT', 'WRONG_PATCH', 'INSUFFICIENT_TESTS', 'VALIDATION_FAILURE', 'MANUAL_EDITS', 'POLICY_PREFERENCE', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "OutcomeSource" AS ENUM ('GITHUB_WEBHOOK', 'USER_FEEDBACK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "CapabilityGateStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "PrOutcome" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "caseId" TEXT,
    "status" "PrOutcomeStatus" NOT NULL,
    "classification" "PrOutcomeClassification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "source" "OutcomeSource" NOT NULL DEFAULT 'GITHUB_WEBHOOK',
    "note" TEXT,
    "rulePackVersion" TEXT,
    "extractorVersion" TEXT,
    "modelVersion" TEXT,
    "promptTemplateVersion" TEXT,
    "graphSnapshotId" TEXT,
    "validationRunId" TEXT,
    "policyDecision" JSONB,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapabilityGate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorSlug" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "status" "CapabilityGateStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapabilityGate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrOutcome_pullRequestId_key" ON "PrOutcome"("pullRequestId");

-- CreateIndex
CREATE INDEX "PrOutcome_organizationId_status_createdAt_idx" ON "PrOutcome"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PrOutcome_organizationId_classification_createdAt_idx" ON "PrOutcome"("organizationId", "classification", "createdAt");

-- CreateIndex
CREATE INDEX "CapabilityGate_organizationId_status_idx" ON "CapabilityGate"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CapabilityGate_organizationId_vendorSlug_level_key" ON "CapabilityGate"("organizationId", "vendorSlug", "level");

-- AddForeignKey
ALTER TABLE "PrOutcome" ADD CONSTRAINT "PrOutcome_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrOutcome" ADD CONSTRAINT "PrOutcome_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrOutcome" ADD CONSTRAINT "PrOutcome_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RemediationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrOutcome" ADD CONSTRAINT "PrOutcome_graphSnapshotId_fkey" FOREIGN KEY ("graphSnapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrOutcome" ADD CONSTRAINT "PrOutcome_validationRunId_fkey" FOREIGN KEY ("validationRunId") REFERENCES "ValidationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapabilityGate" ADD CONSTRAINT "CapabilityGate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
