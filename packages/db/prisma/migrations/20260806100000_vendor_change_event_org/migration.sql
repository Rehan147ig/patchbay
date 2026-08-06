ALTER TABLE "VendorChangeEvent" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "VendorChangeEvent_organizationId_status_idx" ON "VendorChangeEvent"("organizationId", "status");
