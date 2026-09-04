-- Org-scoped autonomous-track guardrails (Renovate-style): PR concurrency
-- cap, minimum release age, minor grouping, CVE stability bypass, package
-- exclusions. One row per org, created lazily with safe defaults.
CREATE TABLE "AutonomyPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "maxOpenAutonomousPRs" INTEGER NOT NULL DEFAULT 5,
    "minimumReleaseAgeDays" INTEGER NOT NULL DEFAULT 3,
    "groupMinorPatches" BOOLEAN NOT NULL DEFAULT true,
    "vulnBypassStability" BOOLEAN NOT NULL DEFAULT true,
    "excludedPackages" TEXT[] NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutonomyPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutonomyPolicy_organizationId_key" ON "AutonomyPolicy"("organizationId");
ALTER TABLE "AutonomyPolicy" ADD CONSTRAINT "AutonomyPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
