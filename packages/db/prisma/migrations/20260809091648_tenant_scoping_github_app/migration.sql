/*
  Tenant-scoping backfill: organizationId is added nullable, backfilled from the
  owning parent row (repository -> scan/usage/assessment -> plan -> artifacts,
  validations, pull requests, approvals), then made NOT NULL. Existing demo data
  keeps its tenant instead of being deleted.
*/
-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('ALLOW_PLAN_ONLY', 'ALLOW_VALIDATE', 'ALLOW_DRAFT_PR', 'REQUIRE_APPROVAL', 'DENY');

-- DropIndex
DROP INDEX "AuditEvent_createdAt_idx";

-- DropIndex
DROP INDEX "PullRequest_remediationPlanId_idx";

-- AlterTable (nullable add -> backfill from parent -> NOT NULL)
ALTER TABLE "RepositoryScan" ADD COLUMN "organizationId" TEXT;
UPDATE "RepositoryScan" t SET "organizationId" = r."organizationId"
  FROM "Repository" r WHERE t."repositoryId" = r."id";
ALTER TABLE "RepositoryScan" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "IntegrationUsage" ADD COLUMN "organizationId" TEXT;
UPDATE "IntegrationUsage" t SET "organizationId" = r."organizationId"
  FROM "Repository" r WHERE t."repositoryId" = r."id";
ALTER TABLE "IntegrationUsage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ImpactAssessment" ADD COLUMN "organizationId" TEXT;
UPDATE "ImpactAssessment" t SET "organizationId" = r."organizationId"
  FROM "Repository" r WHERE t."repositoryId" = r."id";
ALTER TABLE "ImpactAssessment" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ImpactAssessmentUsage" ADD COLUMN "organizationId" TEXT;
UPDATE "ImpactAssessmentUsage" t SET "organizationId" = ia."organizationId"
  FROM "ImpactAssessment" ia WHERE t."impactAssessmentId" = ia."id";
ALTER TABLE "ImpactAssessmentUsage" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RemediationPlan" ADD COLUMN "organizationId" TEXT;
UPDATE "RemediationPlan" t SET "organizationId" = ia."organizationId"
  FROM "ImpactAssessment" ia WHERE t."impactAssessmentId" = ia."id";
ALTER TABLE "RemediationPlan" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PatchArtifact" ADD COLUMN "organizationId" TEXT,
ALTER COLUMN "originalContent" DROP DEFAULT,
ALTER COLUMN "patchedContent" DROP DEFAULT;
UPDATE "PatchArtifact" t SET "organizationId" = rp."organizationId"
  FROM "RemediationPlan" rp WHERE t."remediationPlanId" = rp."id";
ALTER TABLE "PatchArtifact" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PullRequest" ADD COLUMN "organizationId" TEXT;
UPDATE "PullRequest" t SET "organizationId" = rp."organizationId"
  FROM "RemediationPlan" rp WHERE t."remediationPlanId" = rp."id";
ALTER TABLE "PullRequest" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Approval" ADD COLUMN "organizationId" TEXT;
UPDATE "Approval" t SET "organizationId" = rp."organizationId"
  FROM "RemediationPlan" rp WHERE t."remediationPlanId" = rp."id";
ALTER TABLE "Approval" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" TIMESTAMP(3),
ADD COLUMN     "image" TEXT;

-- AlterTable
ALTER TABLE "ValidationRun" ADD COLUMN "organizationId" TEXT;
UPDATE "ValidationRun" t SET "organizationId" = rp."organizationId"
  FROM "RemediationPlan" rp WHERE t."remediationPlanId" = rp."id";
ALTER TABLE "ValidationRun" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "repositorySelection" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GitHubInstallation_organizationId_idx" ON "GitHubInstallation"("organizationId");

-- CreateIndex
CREATE INDEX "Approval_organizationId_idx" ON "Approval"("organizationId");

-- CreateIndex
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

-- CreateIndex
CREATE INDEX "ImpactAssessment_organizationId_idx" ON "ImpactAssessment"("organizationId");

-- CreateIndex
CREATE INDEX "ImpactAssessmentUsage_organizationId_idx" ON "ImpactAssessmentUsage"("organizationId");

-- CreateIndex
CREATE INDEX "IntegrationUsage_organizationId_idx" ON "IntegrationUsage"("organizationId");

-- CreateIndex
CREATE INDEX "PatchArtifact_organizationId_idx" ON "PatchArtifact"("organizationId");

-- CreateIndex
CREATE INDEX "PullRequest_organizationId_idx" ON "PullRequest"("organizationId");

-- CreateIndex
CREATE INDEX "RemediationPlan_organizationId_idx" ON "RemediationPlan"("organizationId");

-- CreateIndex
CREATE INDEX "RepositoryScan_organizationId_idx" ON "RepositoryScan"("organizationId");

-- CreateIndex
CREATE INDEX "ValidationRun_organizationId_idx" ON "ValidationRun"("organizationId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryScan" ADD CONSTRAINT "RepositoryScan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationUsage" ADD CONSTRAINT "IntegrationUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessment" ADD CONSTRAINT "ImpactAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactAssessmentUsage" ADD CONSTRAINT "ImpactAssessmentUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemediationPlan" ADD CONSTRAINT "RemediationPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatchArtifact" ADD CONSTRAINT "PatchArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
