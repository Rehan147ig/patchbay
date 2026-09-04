-- Per-organization SIEM audit-export bearer tokens: argon2id hashes
-- (current + previous for rotation grace), a plaintext lookup prefix for
-- single-verification resolution, and a JSON forwarder config
-- ({ enabled, splunkHecUrl, hecToken, lastForwardedAt, lastForwardedId }).
-- Null hashes = not enrolled.
ALTER TABLE "Organization" ADD COLUMN     "auditExportTokenHash" TEXT,
ADD COLUMN     "auditExportTokenHashPrevious" TEXT,
ADD COLUMN     "auditExportTokenPrefix" TEXT,
ADD COLUMN     "auditExportTokenRotatedAt" TIMESTAMP(3),
ADD COLUMN     "auditExportConfig" JSONB;
