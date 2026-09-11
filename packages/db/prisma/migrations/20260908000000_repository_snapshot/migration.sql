-- RepositorySnapshot boundary: immutable (org, repo, commit) identity for the
-- connected-repository AI pipeline. AI proposes intent only; deterministic code
-- owns checkout, manifest, binding, application, validation, policy, approval,
-- and delivery. The checkout path is temporary execution state (job-owned temp
-- dir, removed in `finally`) and is NEVER persisted — only identifiers, hashes,
-- timestamps, and provenance.
--
-- Fixture repositories flow through the same contract (manifest built from the
-- fixture directory with identical path-safety rules); there is no fixture-only
-- production code path.
--
-- Status vocabulary (plain TEXT, validated at write boundaries):
-- READY | EXPIRED | CLEANED_UP | FAILED.
-- Rollback: DROP TABLE "RepositorySnapshot" + DROP COLUMN
-- "repositorySnapshotId" from AgentRun/PatchArtifact/ValidationRun/
-- RemediationAttempt (provenance-only nullable FKs; data loss is limited to
-- snapshot linkage, never patch content).

-- NOTE: "RepositoryProvider" enum already exists from the initial migration.

CREATE TABLE "RepositorySnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "provider" "RepositoryProvider" NOT NULL,
  "repositoryFullName" TEXT NOT NULL,
  "commitSha" TEXT NOT NULL,
  "treeHash" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "extractorVersion" TEXT,
  "graphSnapshotId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'READY',

  CONSTRAINT "RepositorySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RepositorySnapshot_repositoryId_commitSha_key"
  ON "RepositorySnapshot"("repositoryId", "commitSha");
CREATE INDEX "RepositorySnapshot_org_repo_status_idx"
  ON "RepositorySnapshot"("organizationId", "repositoryId", "status");
CREATE INDEX "RepositorySnapshot_org_status_created_idx"
  ON "RepositorySnapshot"("organizationId", "status", "createdAt");
CREATE INDEX "RepositorySnapshot_repo_status_created_idx"
  ON "RepositorySnapshot"("repositoryId", "status", "createdAt");
CREATE INDEX "RepositorySnapshot_expires_idx" ON "RepositorySnapshot"("expiresAt");
CREATE INDEX "RepositorySnapshot_graph_idx" ON "RepositorySnapshot"("graphSnapshotId");

ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositorySnapshot" ADD CONSTRAINT "RepositorySnapshot_graphSnapshotId_fkey"
  FOREIGN KEY ("graphSnapshotId") REFERENCES "GraphSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: policy covers every row).
ALTER TABLE "RepositorySnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RepositorySnapshot" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RepositorySnapshot_tenant_isolation" ON "RepositorySnapshot";
CREATE POLICY "RepositorySnapshot_tenant_isolation" ON "RepositorySnapshot"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Provenance-only nullable FKs: no metadata duplication on the four writers.
ALTER TABLE "AgentRun" ADD COLUMN "repositorySnapshotId" TEXT;
ALTER TABLE "PatchArtifact" ADD COLUMN "repositorySnapshotId" TEXT;
ALTER TABLE "ValidationRun" ADD COLUMN "repositorySnapshotId" TEXT;
ALTER TABLE "RemediationAttempt" ADD COLUMN "repositorySnapshotId" TEXT;

CREATE INDEX "AgentRun_repositorySnapshotId_idx" ON "AgentRun"("repositorySnapshotId");
CREATE INDEX "PatchArtifact_repositorySnapshotId_idx" ON "PatchArtifact"("repositorySnapshotId");
CREATE INDEX "ValidationRun_repositorySnapshotId_idx" ON "ValidationRun"("repositorySnapshotId");
CREATE INDEX "RemediationAttempt_repositorySnapshotId_idx" ON "RemediationAttempt"("repositorySnapshotId");

ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_repositorySnapshotId_fkey"
  FOREIGN KEY ("repositorySnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PatchArtifact" ADD CONSTRAINT "PatchArtifact_repositorySnapshotId_fkey"
  FOREIGN KEY ("repositorySnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_repositorySnapshotId_fkey"
  FOREIGN KEY ("repositorySnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RemediationAttempt" ADD CONSTRAINT "RemediationAttempt_repositorySnapshotId_fkey"
  FOREIGN KEY ("repositorySnapshotId") REFERENCES "RepositorySnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
