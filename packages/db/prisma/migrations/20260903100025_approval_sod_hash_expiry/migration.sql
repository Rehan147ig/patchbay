-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "patchedHash" TEXT;

-- AlterTable
ALTER TABLE "RemediationPlan" ADD COLUMN     "requestedByUserId" TEXT;
