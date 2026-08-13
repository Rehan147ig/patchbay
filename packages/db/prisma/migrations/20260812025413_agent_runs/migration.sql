-- CreateEnum
CREATE TYPE "AgentRunType" AS ENUM ('PLAN_GENERATION', 'PLAN_REVIEW');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'BUDGET_EXCEEDED');

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('ANALYST', 'PLANNER', 'REVIEWER');

-- CreateEnum
CREATE TYPE "AgentStepKind" AS ENUM ('WORKFLOW', 'TOOL_CALL', 'MODEL_CALL');

-- CreateEnum
CREATE TYPE "AgentStepStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "releaseRecordId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "releaseRepositoryMatchId" TEXT,
    "type" "AgentRunType" NOT NULL DEFAULT 'PLAN_REVIEW',
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "correlationId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTemplateVersion" TEXT NOT NULL,
    "redactedInputDigest" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "outputJson" JSONB,
    "tokenUsage" JSONB,
    "costEstimateCents" INTEGER NOT NULL DEFAULT 0,
    "budgetCents" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL,
    "kind" "AgentStepKind" NOT NULL,
    "status" "AgentStepStatus" NOT NULL DEFAULT 'STARTED',
    "toolName" TEXT,
    "inputDigest" TEXT NOT NULL,
    "outputJson" JSONB,
    "tokenUsage" JSONB,
    "latencyMs" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_status_idx" ON "AgentRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_releaseRecordId_repositoryId_idx" ON "AgentRun"("organizationId", "releaseRecordId", "repositoryId");

-- CreateIndex
CREATE INDEX "AgentRun_releaseRecordId_createdAt_idx" ON "AgentRun"("releaseRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentStep_agentRunId_idx" ON "AgentStep"("agentRunId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_releaseRecordId_fkey" FOREIGN KEY ("releaseRecordId") REFERENCES "ReleaseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_releaseRepositoryMatchId_fkey" FOREIGN KEY ("releaseRepositoryMatchId") REFERENCES "ReleaseRepositoryMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
