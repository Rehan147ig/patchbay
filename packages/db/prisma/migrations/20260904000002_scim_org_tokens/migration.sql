-- Per-organization SCIM 2.0 bearer tokens: argon2id hashes (current +
-- previous for rotation grace) plus a plaintext lookup prefix so each request
-- runs a single expensive verification. Null hashes = not enrolled.
ALTER TABLE "Organization" ADD COLUMN     "scimTokenHash" TEXT,
ADD COLUMN     "scimTokenHashPrevious" TEXT,
ADD COLUMN     "scimTokenPrefix" TEXT,
ADD COLUMN     "scimTokenRotatedAt" TIMESTAMP(3);
