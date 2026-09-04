-- Backfill repositories connected through the picker flow, which stored a
-- `github:`-prefixed externalId, to the canonical bare GitHub repository id
-- used by the provider, the install-callback flow, and the webhook readers.
-- Rows that would collide with an existing bare row for the same organization
-- are left untouched for manual dedupe; webhook readers match both formats.
UPDATE "Repository" SET "externalId" = substr("externalId", 8)
WHERE "externalId" LIKE 'github:%'
AND NOT EXISTS (
  SELECT 1 FROM "Repository" AS "r2"
  WHERE "r2"."organizationId" = "Repository"."organizationId"
  AND "r2"."externalId" = substr("Repository"."externalId", 8)
);
