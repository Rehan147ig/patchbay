-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "RepositoryProvider" AS ENUM ('GITHUB', 'LOCAL');

-- CreateEnum
CREATE TYPE "RepositoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "VendorChangeSource" AS ENUM ('MANUAL', 'SDK_RELEASE', 'OPENAPI_DIFF', 'CHANGELOG', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "VendorChangeStatus" AS ENUM ('DETECTED', 'TRIAGED', 'REMEDIATION_STARTED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('SDK_VERSION_UPGRADE', 'METHOD_RENAMED', 'METHOD_REMOVED', 'PARAMETER_RENAMED', 'PARAMETER_REMOVED', 'PARAMETER_REQUIRED', 'RESPONSE_FIELD_REMOVED', 'RESPONSE_FIELD_TYPE_CHANGED', 'ENDPOINT_REMOVED', 'AUTH_CHANGE', 'WEBHOOK_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "UsageType" AS ENUM ('IMPORT', 'INITIALIZATION', 'METHOD_CALL', 'ENDPOINT_CALL', 'CONFIG', 'WEBHOOK', 'ENVIRONMENT_REFERENCE');

-- CreateEnum
CREATE TYPE "RiskTag" AS ENUM ('PAYMENT', 'AUTH', 'PII', 'WEBHOOK', 'INFRASTRUCTURE', 'TEST_ONLY', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ImpactStatus" AS ENUM ('NOT_AFFECTED', 'POSSIBLY_AFFECTED', 'AFFECTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'READY_FOR_VALIDATION', 'VALIDATING', 'VALIDATED', 'BLOCKED', 'PR_CREATED', 'FAILED');

-- CreateEnum
CREATE TYPE "GenerationMethod" AS ENUM ('RULE_BASED', 'AI_ASSISTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PullRequestStatus" AS ENUM ('DRAFT', 'OPEN', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'AGENT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "RepositoryProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "languageProfile" JSONB NOT NULL,
    "status" "RepositoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryScan" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "docsUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorChangeEvent" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "externalReference" TEXT,
    "sourceType" "VendorChangeSource" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "rawPayload" JSONB,
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "status" "VendorChangeStatus" NOT NULL DEFAULT 'DETECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedChange" (
    "id" TEXT NOT NULL,
    "changeEventId" TEXT NOT NULL,
    "changeType" "ChangeType" NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "description" TEXT,
    "breaking" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationUsage" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "scanId" TEXT,
    "vendorId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "usageType" "UsageType" NOT NULL,
    "astLocation" JSONB,
    "surroundingCodeHash" TEXT,
    "codeExcerpt" JSONB,
    "metadata" JSONB,
    "ownerHint" TEXT NOT NULL DEFAULT 'Unassigned',
    "riskTags" "RiskTag"[] DEFAULT ARRAY[]::"RiskTag"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactAssessment" (
    "id" TEXT NOT NULL,
    "changeEventId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "affectedUsageCount" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "RiskLevel" NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "ImpactStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactAssessmentUsage" (
    "impactAssessmentId" TEXT NOT NULL,
    "usageId" TEXT NOT NULL,

    CONSTRAINT "ImpactAssessmentUsage_pkey" PRIMARY KEY ("impactAssessmentId","usageId")
);

-- CreateTable
CREATE TABLE "RemediationPlan" (
    "id" TEXT NOT NULL,
    "impactAssessmentId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "strategy" TEXT NOT NULL,
    "proposedChanges" JSONB,
    "confidence" INTEGER NOT NULL,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "policyDecision" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemediationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatchArtifact" (
    "id" TEXT NOT NULL,
    "remediationPlanId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "unifiedDiff" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "patchedHash" TEXT NOT NULL,
    "generationMethod" "GenerationMethod" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatchArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRun" (
    "id" TEXT NOT NULL,
    "remediationPlanId" TEXT NOT NULL,
    "status" "ValidationStatus" NOT NULL DEFAULT 'QUEUED',
    "commands" JSONB NOT NULL,
    "stdout" TEXT,
    "stderr" TEXT,
    "exitCode" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "remediationPlanId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "url" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "status" "PullRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "definitionJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "remediationPlanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "correlationId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Repository_organizationId_idx" ON "Repository"("organizationId");

-- CreateIndex
CREATE INDEX "Repository_name_idx" ON "Repository"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_organizationId_externalId_key" ON "Repository"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "RepositoryScan_repositoryId_status_idx" ON "RepositoryScan"("repositoryId", "status");

-- CreateIndex
CREATE INDEX "RepositoryScan_repositoryId_createdAt_idx" ON "RepositoryScan"("repositoryId", "createdAt");

-- CreateIndex
CREATE INDEX "RepositoryScan_status_idx" ON "RepositoryScan"("status");

-- CreateIndex
CREATE INDEX "RepositoryScan_createdAt_idx" ON "RepositoryScan"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_slug_key" ON "Vendor"("slug");

-- CreateIndex
CREATE INDEX "VendorChangeEvent_vendorId_status_idx" ON "VendorChangeEvent"("vendorId", "status");

-- CreateIndex
CREATE INDEX "VendorChangeEvent_status_createdAt_idx" ON "VendorChangeEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VendorChangeEvent_detectedAt_idx" ON "VendorChangeEvent"("detectedAt");

-- CreateIndex
CREATE INDEX "NormalizedChange_changeEventId_idx" ON "NormalizedChange"("changeEventId");

-- CreateIndex
CREATE INDEX "NormalizedChange_changeType_idx" ON "NormalizedChange"("changeType");

-- CreateIndex
CREATE INDEX "IntegrationUsage_repositoryId_vendorId_idx" ON "IntegrationUsage"("repositoryId", "vendorId");

-- CreateIndex
CREATE INDEX "IntegrationUsage_filePath_idx" ON "IntegrationUsage"("filePath");

-- CreateIndex
CREATE INDEX "IntegrationUsage_symbol_idx" ON "IntegrationUsage"("symbol");

-- CreateIndex
CREATE INDEX "IntegrationUsage_scanId_idx" ON "IntegrationUsage"("scanId");

-- CreateIndex
CREATE INDEX "ImpactAssessment_repositoryId_idx" ON "ImpactAssessment"("repositoryId");

-- CreateIndex
CREATE INDEX "ImpactAssessment_status_idx" ON "ImpactAssessment"("status");

-- CreateIndex
CREATE INDEX "ImpactAssessment_createdAt_idx" ON "ImpactAssessment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactAssessment_changeEventId_repositoryId_key" ON "ImpactAssessment"("changeEventId", "repositoryId");

-- CreateIndex
CREATE INDEX "ImpactAssessmentUsage_usageId_idx" ON "ImpactAssessmentUsage"("usageId");

-- CreateIndex
CREATE INDEX "RemediationPlan_impactAssessmentId_idx" ON "RemediationPlan"("impactAssessmentId");

-- CreateIndex
CREATE INDEX "RemediationPlan_status_idx" ON "RemediationPlan"("status");

-- CreateIndex
CREATE INDEX "RemediationPlan_createdAt_idx" ON "RemediationPlan"("createdAt");

-- CreateIndex
CREATE INDEX "PatchArtifact_remediationPlanId_idx" ON "PatchArtifact"("remediationPlanId");

-- CreateIndex
CREATE INDEX "ValidationRun_remediationPlanId_idx" ON "ValidationRun"("remediationPlanId");

-- CreateIndex
CREATE INDEX "ValidationRun_status_idx" ON "ValidationRun"("status");

-- CreateIndex
CREATE INDEX "ValidationRun_createdAt_idx" ON "ValidationRun"("createdAt");

-- CreateIndex
CREATE INDEX "PullRequest_remediationPlanId_idx" ON "PullRequest"("remediationPlanId");

-- CreateIndex
CREATE INDEX "PullRequest_status_idx" ON "PullRequest"("status");

-- CreateIndex
CREATE INDEX "Policy_organizationId_idx" ON "Policy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_organizationId_name_key" ON "Policy"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Approval_remediationPlanId_idx" ON "Approval"("remediationPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_remediationPlanId_userId_decision_key" ON "Approval"("remediationPlanId", "userId", "decision");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryScan" ADD CONSTRAINT "RepositoryScan_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorChangeEvent" ADD CONSTRAINT "VendorChangeEvent_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedChange" ADD CONSTRAINT "NormalizedChange_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "VendorChangeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationUsage" ADD CONSTRAINT "IntegrationUsage_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationUsage" ADD CONSTRAINT "IntegrationUsage_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "RepositoryScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationUsage" ADD CONSTRAINT "IntegrationUsage_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessment" ADD CONSTRAINT "ImpactAssessment_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "VendorChangeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessment" ADD CONSTRAINT "ImpactAssessment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessmentUsage" ADD CONSTRAINT "ImpactAssessmentUsage_impactAssessmentId_fkey" FOREIGN KEY ("impactAssessmentId") REFERENCES "ImpactAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessmentUsage" ADD CONSTRAINT "ImpactAssessmentUsage_usageId_fkey" FOREIGN KEY ("usageId") REFERENCES "IntegrationUsage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_impactAssessmentId_fkey" FOREIGN KEY ("impactAssessmentId") REFERENCES "ImpactAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatchArtifact" ADD CONSTRAINT "PatchArtifact_remediationPlanId_fkey" FOREIGN KEY ("remediationPlanId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_remediationPlanId_fkey" FOREIGN KEY ("remediationPlanId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_remediationPlanId_fkey" FOREIGN KEY ("remediationPlanId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_remediationPlanId_fkey" FOREIGN KEY ("remediationPlanId") REFERENCES "RemediationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

