-- CreateEnum
CREATE TYPE "GraphSnapshotStatus" AS ENUM ('INDEXING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "GraphIndexMode" AS ENUM ('BASELINE', 'INCREMENTAL');

-- CreateEnum
CREATE TYPE "GraphNodeKind" AS ENUM ('REPOSITORY', 'FILE', 'MODULE', 'SYMBOL', 'FUNCTION', 'CLASS', 'DEPENDENCY', 'PACKAGE', 'API_CLIENT', 'API_OPERATION', 'CONFIGURATION_KEY', 'TEST', 'SERVICE', 'QUEUE_TOPIC', 'DATABASE');

-- CreateEnum
CREATE TYPE "GraphEdgeKind" AS ENUM ('CONTAINS', 'EXPORTS', 'IMPORTS', 'CALLS', 'EXTENDS', 'DECLARES', 'RESOLVES_TO', 'USES_PACKAGE', 'AFFECTED_BY', 'CREATES_CLIENT', 'INVOKES_API', 'READS_CONFIG', 'TESTS', 'BELONGS_TO_SERVICE', 'PUBLISHES', 'CONSUMES', 'ACCESSES');

-- CreateEnum
CREATE TYPE "GraphProvenance" AS ENUM ('EXTRACTED', 'RESOLVED', 'INFERRED', 'AMBIGUOUS');

-- CreateTable
CREATE TABLE "GraphSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "extractionVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "GraphSnapshotStatus" NOT NULL DEFAULT 'INDEXING',
    "rootTreeHash" TEXT NOT NULL,
    "changedPaths" JSONB,
    "nodesAffected" INTEGER NOT NULL DEFAULT 0,
    "edgesAffected" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GraphSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" "GraphNodeKind" NOT NULL,
    "stableKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "filePath" TEXT,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "propertiesJson" JSONB,
    "contentHash" TEXT NOT NULL,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "kind" "GraphEdgeKind" NOT NULL,
    "provenance" "GraphProvenance" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "evidenceJson" JSONB,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphSourceEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "nodeId" TEXT,
    "edgeId" TEXT,
    "filePath" TEXT NOT NULL,
    "startLine" INTEGER,
    "endLine" INTEGER,
    "extractor" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,

    CONSTRAINT "GraphSourceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphIndexJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "mode" "GraphIndexMode" NOT NULL,
    "status" "GraphSnapshotStatus" NOT NULL DEFAULT 'INDEXING',
    "changedPaths" JSONB,
    "correlationId" TEXT NOT NULL,
    "error" TEXT,
    "timingsJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GraphIndexJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GraphSnapshot_organizationId_repositoryId_status_idx" ON "GraphSnapshot"("organizationId", "repositoryId", "status");

-- CreateIndex
CREATE INDEX "GraphSnapshot_repositoryId_status_createdAt_idx" ON "GraphSnapshot"("repositoryId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GraphSnapshot_repositoryId_commitSha_extractionVersion_key" ON "GraphSnapshot"("repositoryId", "commitSha", "extractionVersion");

-- CreateIndex
CREATE INDEX "GraphNode_organizationId_repositoryId_snapshotId_kind_idx" ON "GraphNode"("organizationId", "repositoryId", "snapshotId", "kind");

-- CreateIndex
CREATE INDEX "GraphNode_organizationId_snapshotId_filePath_idx" ON "GraphNode"("organizationId", "snapshotId", "filePath");

-- CreateIndex
CREATE INDEX "GraphNode_repositoryId_stableKey_idx" ON "GraphNode"("repositoryId", "stableKey");

-- CreateIndex
CREATE INDEX "GraphNode_contentHash_idx" ON "GraphNode"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_snapshotId_kind_stableKey_key" ON "GraphNode"("snapshotId", "kind", "stableKey");

-- CreateIndex
CREATE INDEX "GraphEdge_organizationId_snapshotId_fromNodeId_idx" ON "GraphEdge"("organizationId", "snapshotId", "fromNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_organizationId_snapshotId_toNodeId_idx" ON "GraphEdge"("organizationId", "snapshotId", "toNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_organizationId_snapshotId_kind_idx" ON "GraphEdge"("organizationId", "snapshotId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_snapshotId_kind_fromNodeId_toNodeId_key" ON "GraphEdge"("snapshotId", "kind", "fromNodeId", "toNodeId");

-- CreateIndex
CREATE INDEX "graph_evidence_node_idx" ON "GraphSourceEvidence"("organizationId", "repositoryId", "snapshotId", "nodeId");

-- CreateIndex
CREATE INDEX "graph_evidence_edge_idx" ON "GraphSourceEvidence"("organizationId", "repositoryId", "snapshotId", "edgeId");

-- CreateIndex
CREATE INDEX "GraphSourceEvidence_snapshotId_extractor_idx" ON "GraphSourceEvidence"("snapshotId", "extractor");

-- CreateIndex
CREATE INDEX "GraphIndexJob_organizationId_repositoryId_status_idx" ON "GraphIndexJob"("organizationId", "repositoryId", "status");

-- CreateIndex
CREATE INDEX "GraphIndexJob_repositoryId_startedAt_idx" ON "GraphIndexJob"("repositoryId", "startedAt");

-- AddForeignKey
ALTER TABLE "GraphSnapshot" ADD CONSTRAINT "GraphSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphSnapshot" ADD CONSTRAINT "GraphSnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphNode" ADD CONSTRAINT "GraphNode_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphSourceEvidence" ADD CONSTRAINT "GraphSourceEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphSourceEvidence" ADD CONSTRAINT "GraphSourceEvidence_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphSourceEvidence" ADD CONSTRAINT "GraphSourceEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphSourceEvidence" ADD CONSTRAINT "GraphSourceEvidence_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphSourceEvidence" ADD CONSTRAINT "GraphSourceEvidence_edgeId_fkey" FOREIGN KEY ("edgeId") REFERENCES "GraphEdge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphIndexJob" ADD CONSTRAINT "GraphIndexJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphIndexJob" ADD CONSTRAINT "GraphIndexJob_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphIndexJob" ADD CONSTRAINT "GraphIndexJob_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
