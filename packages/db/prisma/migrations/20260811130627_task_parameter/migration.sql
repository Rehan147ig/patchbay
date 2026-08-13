-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "TaskParameter" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "deadline" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskParameter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskParameter_type_status_idx" ON "TaskParameter"("type", "status");

-- CreateIndex
CREATE INDEX "TaskParameter_status_idx" ON "TaskParameter"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskParameter_taskId_type_key" ON "TaskParameter"("taskId", "type");
