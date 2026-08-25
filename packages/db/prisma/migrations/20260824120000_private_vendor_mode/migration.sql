-- Private Vendor mode (#1): backfill relation plumbing for the existing
-- nullable organizationId column (introduced by vendor_agent_mode).
-- No data change: seeded catalog vendors keep organizationId = NULL.

CREATE INDEX "Vendor_organizationId_idx" ON "Vendor"("organizationId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Vendor_organizationId_fkey'
    ) THEN
        ALTER TABLE "Vendor"
            ADD CONSTRAINT "Vendor_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
