-- AlterTable
ALTER TABLE "RepositoryScan" ADD COLUMN     "progressStage" TEXT,
ADD COLUMN     "progressScanned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "progressTotal" INTEGER;
