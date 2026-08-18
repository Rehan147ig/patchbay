-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'mock',
ADD COLUMN     "latencyMs" INTEGER;

-- AlterTable
ALTER TABLE "AgentStep" ADD COLUMN     "providerRequestId" TEXT;