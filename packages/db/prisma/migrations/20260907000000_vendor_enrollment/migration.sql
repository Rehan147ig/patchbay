-- P0-1 organization-scoped vendor credentials: per-org enrollment rows so a
-- shared catalog Vendor never carries one tenant's agent-key hash.
--
-- Backfill: every Vendor row that already holds an agent key for an org gets
-- one ACTIVE enrollment with the same hashes (ON CONFLICT DO NOTHING makes
-- the statement idempotent and rerunnable). Legacy Vendor.agentKeyHash /
-- agentKeyHashPrevious columns are intentionally LEFT IN PLACE: dropping them
-- in the same migration would break rollback (reverting code would lose keys
-- issued between migrate and rollback). Remove them in a later migration
-- once no code reads them.
-- Rollback: DROP TABLE "OrganizationVendorEnrollment" (legacy columns keep
-- serving reverted code; enrollments created after migrate are orphaned and
-- must be re-issued).

CREATE TABLE "OrganizationVendorEnrollment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "agentKeyHash" TEXT,
  "agentKeyHashPrevious" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationVendorEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationVendorEnrollment_organizationId_vendorId_key"
  ON "OrganizationVendorEnrollment"("organizationId", "vendorId");
CREATE INDEX "OrganizationVendorEnrollment_org_idx" ON "OrganizationVendorEnrollment"("organizationId");
CREATE INDEX "OrganizationVendorEnrollment_vendor_idx" ON "OrganizationVendorEnrollment"("vendorId");

ALTER TABLE "OrganizationVendorEnrollment" ADD CONSTRAINT "OrganizationVendorEnrollment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationVendorEnrollment" ADD CONSTRAINT "OrganizationVendorEnrollment_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-isolation RLS (organizationId non-nullable: the policy covers every row).
ALTER TABLE "OrganizationVendorEnrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationVendorEnrollment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "OrganizationVendorEnrollment_tenant_isolation" ON "OrganizationVendorEnrollment";
CREATE POLICY "OrganizationVendorEnrollment_tenant_isolation" ON "OrganizationVendorEnrollment"
  USING ("organizationId" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organizationId" = current_setting('app.current_organization_id', true));

-- Backfill enrollments from legacy per-org vendor key hashes.
-- gen_random_uuid() is built-in since Postgres 13 (no extension needed);
-- ON CONFLICT makes the statement idempotent and rerunnable.
INSERT INTO "OrganizationVendorEnrollment"
  ("id", "organizationId", "vendorId", "agentKeyHash", "agentKeyHashPrevious", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "Vendor"."organizationId",
  "Vendor"."id",
  "Vendor"."agentKeyHash",
  "Vendor"."agentKeyHashPrevious",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Vendor"
WHERE "Vendor"."organizationId" IS NOT NULL
  AND "Vendor"."agentKeyHash" IS NOT NULL
ON CONFLICT ("organizationId", "vendorId") DO NOTHING;
