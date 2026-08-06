-- AlterTable
ALTER TABLE "PatchArtifact" ADD COLUMN "originalContent" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PatchArtifact" ADD COLUMN "patchedContent" TEXT NOT NULL DEFAULT '';
