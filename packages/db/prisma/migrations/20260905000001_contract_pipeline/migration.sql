-- WP2 contract pipeline: ContractSource / ContractSnapshot / ContractChange.
-- Source identity is unique per org via the Prisma @@unique; public (NULL-org)
-- rows need a partial unique index because Postgres NULLS DISTINCT does not
-- deduplicate NULL organizationIds.
--
-- RLS note: ContractSource is intentionally NOT added to the tenant-isolation
-- policies (same rationale as Vendor in 20260902000000_rls_foundation): the
-- USING (organizationId = current_setting(...)) policy would hide public
-- NULL-org rows from every tenant. Reads filter organizationId IN {NULL, org}
-- explicitly at call sites (see contract-pipeline.ts); ContractSnapshot and
-- ContractChange carry no organizationId and are reachable only through the
-- source join.

CREATE TABLE "ContractSource" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "vendorSlug" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "configEncrypted" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastObservedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContractSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractSource_organizationId_vendorSlug_kind_name_key"
  ON "ContractSource"("organizationId", "vendorSlug", "kind", "name");
CREATE UNIQUE INDEX "ContractSource_public_identity_key"
  ON "ContractSource"("vendorSlug", "kind", "name") WHERE "organizationId" IS NULL;
CREATE INDEX "ContractSource_vendorSlug_kind_idx" ON "ContractSource"("vendorSlug", "kind");
CREATE INDEX "ContractSource_organizationId_status_idx" ON "ContractSource"("organizationId", "status");

CREATE TABLE "ContractSnapshot" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "normalizedHash" TEXT NOT NULL,
  "rawArtifactUri" TEXT,
  "normalizedJson" JSONB NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provenanceJson" JSONB,

  CONSTRAINT "ContractSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractSnapshot_sourceId_contentHash_key"
  ON "ContractSnapshot"("sourceId", "contentHash");
CREATE INDEX "ContractSnapshot_sourceId_observedAt_idx" ON "ContractSnapshot"("sourceId", "observedAt");

CREATE TABLE "ContractChange" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "fromSnapshotId" TEXT,
  "toSnapshotId" TEXT NOT NULL,
  "changeType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "identity" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidenceJson" JSONB,
  "migrationHintsJson" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractChange_sourceId_toSnapshotId_identity_key"
  ON "ContractChange"("sourceId", "toSnapshotId", "identity");
CREATE INDEX "ContractChange_sourceId_status_idx" ON "ContractChange"("sourceId", "status");
CREATE INDEX "ContractChange_toSnapshotId_idx" ON "ContractChange"("toSnapshotId");

ALTER TABLE "ContractSource" ADD CONSTRAINT "ContractSource_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractSnapshot" ADD CONSTRAINT "ContractSnapshot_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "ContractSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractChange" ADD CONSTRAINT "ContractChange_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "ContractSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractChange" ADD CONSTRAINT "ContractChange_fromSnapshotId_fkey"
  FOREIGN KEY ("fromSnapshotId") REFERENCES "ContractSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContractChange" ADD CONSTRAINT "ContractChange_toSnapshotId_fkey"
  FOREIGN KEY ("toSnapshotId") REFERENCES "ContractSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
