-- CreateEnum
CREATE TYPE "ReleaseSource" AS ENUM ('NPM', 'GITHUB_RELEASE', 'OPENAPI', 'VENDOR_MANIFEST', 'CHANGELOG');

-- CreateEnum
CREATE TYPE "ReleaseAuthenticity" AS ENUM ('VERIFIED', 'SOURCE_TRUSTED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('OBSERVED', 'CLASSIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReleaseMatchStatus" AS ENUM ('CANDIDATE', 'NOT_RELEVANT', 'MONITOR', 'REVIEW', 'REMEDIATE');

-- CreateEnum
CREATE TYPE "DetectionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReleaseClassificationMethod" AS ENUM ('DETERMINISTIC', 'AI', 'MANUAL');

-- CreateTable
CREATE TABLE "VendorProduct" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "repositoryUrl" TEXT,
    "openApiUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseRecord" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" "ReleaseSource" NOT NULL,
    "version" TEXT NOT NULL,
    "previousVersion" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "authenticity" "ReleaseAuthenticity" NOT NULL DEFAULT 'SOURCE_TRUSTED',
    "status" "ReleaseStatus" NOT NULL DEFAULT 'OBSERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseEvidence" (
    "id" TEXT NOT NULL,
    "releaseRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "objectStorageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepositoryDependency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "declaredRange" TEXT,
    "resolvedVersion" TEXT NOT NULL,
    "lockfileKind" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepositoryDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseRepositoryMatch" (
    "id" TEXT NOT NULL,
    "releaseRecordId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,
    "matchReason" TEXT NOT NULL,
    "affectedVersionRange" TEXT,
    "status" "ReleaseMatchStatus" NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseRepositoryMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseClassification" (
    "id" TEXT NOT NULL,
    "releaseRecordId" TEXT NOT NULL,
    "method" "ReleaseClassificationMethod" NOT NULL,
    "factsJson" JSONB NOT NULL,
    "confidence" INTEGER NOT NULL,
    "confidenceBreakdown" JSONB NOT NULL,
    "requiresHumanReview" BOOLEAN NOT NULL,
    "modelTraceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionRun" (
    "id" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "status" "DetectionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cursor" JSONB,
    "observedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "DetectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorProduct_ecosystem_enabled_idx" ON "VendorProduct"("ecosystem", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "VendorProduct_vendorId_ecosystem_packageName_key" ON "VendorProduct"("vendorId", "ecosystem", "packageName");

-- CreateIndex
CREATE INDEX "ReleaseRecord_productId_publishedAt_idx" ON "ReleaseRecord"("productId", "publishedAt");

-- CreateIndex
CREATE INDEX "ReleaseRecord_status_idx" ON "ReleaseRecord"("status");

-- CreateIndex
CREATE INDEX "ReleaseRecord_publishedAt_idx" ON "ReleaseRecord"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseRecord_source_productId_version_contentHash_key" ON "ReleaseRecord"("source", "productId", "version", "contentHash");

-- CreateIndex
CREATE INDEX "ReleaseEvidence_releaseRecordId_idx" ON "ReleaseEvidence"("releaseRecordId");

-- CreateIndex
CREATE INDEX "RepositoryDependency_organizationId_idx" ON "RepositoryDependency"("organizationId");

-- CreateIndex
CREATE INDEX "RepositoryDependency_packageName_idx" ON "RepositoryDependency"("packageName");

-- CreateIndex
CREATE UNIQUE INDEX "RepositoryDependency_repositoryId_packageName_commitSha_key" ON "RepositoryDependency"("repositoryId", "packageName", "commitSha");

-- CreateIndex
CREATE INDEX "ReleaseRepositoryMatch_organizationId_status_idx" ON "ReleaseRepositoryMatch"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ReleaseRepositoryMatch_releaseRecordId_idx" ON "ReleaseRepositoryMatch"("releaseRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseRepositoryMatch_releaseRecordId_repositoryId_depende_key" ON "ReleaseRepositoryMatch"("releaseRecordId", "repositoryId", "dependencyId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseClassification_releaseRecordId_key" ON "ReleaseClassification"("releaseRecordId");

-- CreateIndex
CREATE INDEX "DetectionRun_adapter_startedAt_idx" ON "DetectionRun"("adapter", "startedAt");

-- AddForeignKey
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRecord" ADD CONSTRAINT "ReleaseRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "VendorProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseEvidence" ADD CONSTRAINT "ReleaseEvidence_releaseRecordId_fkey" FOREIGN KEY ("releaseRecordId") REFERENCES "ReleaseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryDependency" ADD CONSTRAINT "RepositoryDependency_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepositoryDependency" ADD CONSTRAINT "RepositoryDependency_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRepositoryMatch" ADD CONSTRAINT "ReleaseRepositoryMatch_releaseRecordId_fkey" FOREIGN KEY ("releaseRecordId") REFERENCES "ReleaseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRepositoryMatch" ADD CONSTRAINT "ReleaseRepositoryMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRepositoryMatch" ADD CONSTRAINT "ReleaseRepositoryMatch_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRepositoryMatch" ADD CONSTRAINT "ReleaseRepositoryMatch_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "RepositoryDependency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseClassification" ADD CONSTRAINT "ReleaseClassification_releaseRecordId_fkey" FOREIGN KEY ("releaseRecordId") REFERENCES "ReleaseRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
