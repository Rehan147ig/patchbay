-- AlterTable
ALTER TABLE "DetectionRun" ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "rejectionReason" TEXT;
