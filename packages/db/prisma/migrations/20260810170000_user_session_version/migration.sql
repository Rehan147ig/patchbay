-- Session rotation: bump this counter whenever a user's privileges change.
-- Issued sessions embed the version they were created at and are rejected
-- once the stored version no longer matches.

ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
