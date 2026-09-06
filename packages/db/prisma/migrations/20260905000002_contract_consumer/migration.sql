-- WP3 consumer graph expansion: ContractConsumer + graph node kinds.
-- versionRange participates in the Prisma @@unique for ranged consumers; rows
-- with a NULL range (MCP servers, event handlers — statically versionless)
-- need a partial unique index because Postgres NULLS DISTINCT does not
-- deduplicate them (same pattern as the WP2 ContractSource public index).

ALTER TYPE "GraphNodeKind" ADD VALUE IF NOT EXISTS 'MCP_SERVER';
ALTER TYPE "GraphNodeKind" ADD VALUE IF NOT EXISTS 'EVENT_HANDLER';

CREATE TABLE "ContractConsumer" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "contractSourceId" TEXT NOT NULL,
  "contractKind" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "versionRange" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "evidenceJson" JSONB,
  "graphSnapshotId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractConsumer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractConsumer_org_repo_source_identifier_range_key"
  ON "ContractConsumer"("organizationId", "repositoryId", "contractSourceId", "identifier", "versionRange");
CREATE UNIQUE INDEX "ContractConsumer_unranged_identity_key"
  ON "ContractConsumer"("organizationId", "repositoryId", "contractSourceId", "identifier")
  WHERE "versionRange" IS NULL;
CREATE INDEX "ContractConsumer_org_repo_idx" ON "ContractConsumer"("organizationId", "repositoryId");
CREATE INDEX "ContractConsumer_org_source_idx" ON "ContractConsumer"("organizationId", "contractSourceId");
CREATE INDEX "ContractConsumer_source_idx" ON "ContractConsumer"("contractSourceId");

ALTER TABLE "ContractConsumer" ADD CONSTRAINT "ContractConsumer_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractConsumer" ADD CONSTRAINT "ContractConsumer_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractConsumer" ADD CONSTRAINT "ContractConsumer_contractSourceId_fkey"
  FOREIGN KEY ("contractSourceId") REFERENCES "ContractSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractConsumer" ADD CONSTRAINT "ContractConsumer_graphSnapshotId_fkey"
  FOREIGN KEY ("graphSnapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-isolation RLS for the new org-owned table (same policy shape as the
-- WP3-era foundation tables; ContractConsumer.organizationId is non-nullable
-- so the policy covers every row, unlike the MIXED ContractSource/Vendor).
ALTER TABLE "ContractConsumer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractConsumer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ContractConsumer_tenant_isolation" ON "ContractConsumer";
CREATE POLICY "ContractConsumer_tenant_isolation" ON "ContractConsumer"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));
