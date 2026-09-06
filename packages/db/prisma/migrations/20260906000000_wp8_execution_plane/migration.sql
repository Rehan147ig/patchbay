-- WP8 isolated execution plane (spec §19/§9): ValidationProfile and
-- ValidationArtifact, plus ValidationRun.validationProfileId provenance.
--
-- Profiles pin fixed allowlist command identifiers (never raw command
-- strings), image references + digests, timeouts, memory limits, and network
-- policy. Artifacts attest one terminal run: command set hash, per-command
-- exit codes, resolved image digest, content-addressed full logs, and a
-- tamper-evident descriptor hash.

CREATE TABLE "ValidationProfile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "name" TEXT NOT NULL,
  "commandIds" TEXT[] NOT NULL,
  "image" TEXT NOT NULL,
  "imageDigest" TEXT,
  "timeoutMs" INTEGER NOT NULL,
  "memoryLimit" TEXT NOT NULL DEFAULT '512m',
  "networkPolicy" TEXT NOT NULL DEFAULT 'none',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ValidationProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ValidationProfile_org_repo_name_key"
  ON "ValidationProfile"("organizationId", "repositoryId", "name");
CREATE INDEX "ValidationProfile_org_idx" ON "ValidationProfile"("organizationId");
CREATE INDEX "ValidationProfile_repo_idx" ON "ValidationProfile"("repositoryId");

ALTER TABLE "ValidationProfile" ADD CONSTRAINT "ValidationProfile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValidationProfile" ADD CONSTRAINT "ValidationProfile_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: the policy covers every row).
ALTER TABLE "ValidationProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ValidationProfile_tenant_isolation" ON "ValidationProfile";
CREATE POLICY "ValidationProfile_tenant_isolation" ON "ValidationProfile"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

CREATE TABLE "ValidationArtifact" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "validationRunId" TEXT NOT NULL,
  "validationProfileId" TEXT,
  "commandSetHash" TEXT NOT NULL,
  "commandsExecuted" TEXT[] NOT NULL,
  "exitCodes" INTEGER[] NOT NULL,
  "image" TEXT,
  "imageDigest" TEXT,
  "stdoutUri" TEXT,
  "stderrUri" TEXT,
  "stdoutComplete" BOOLEAN NOT NULL DEFAULT true,
  "stderrComplete" BOOLEAN NOT NULL DEFAULT true,
  "artifactHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ValidationArtifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ValidationArtifact_validationRunId_key"
  ON "ValidationArtifact"("validationRunId");
CREATE INDEX "ValidationArtifact_org_created_idx"
  ON "ValidationArtifact"("organizationId", "createdAt");

ALTER TABLE "ValidationArtifact" ADD CONSTRAINT "ValidationArtifact_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValidationArtifact" ADD CONSTRAINT "ValidationArtifact_validationRunId_fkey"
  FOREIGN KEY ("validationRunId") REFERENCES "ValidationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ValidationArtifact" ADD CONSTRAINT "ValidationArtifact_validationProfileId_fkey"
  FOREIGN KEY ("validationProfileId") REFERENCES "ValidationProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: the policy covers every row).
ALTER TABLE "ValidationArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationArtifact" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ValidationArtifact_tenant_isolation" ON "ValidationArtifact";
CREATE POLICY "ValidationArtifact_tenant_isolation" ON "ValidationArtifact"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Provenance: which profile backed a run (null = legacy static command set).
ALTER TABLE "ValidationRun" ADD COLUMN "validationProfileId" TEXT;

ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_validationProfileId_fkey"
  FOREIGN KEY ("validationProfileId") REFERENCES "ValidationProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
