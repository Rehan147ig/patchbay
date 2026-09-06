import { prisma } from "./client";
import { deleteEvidenceObject } from "./object-store";

/**
 * Validation artifact retention (WP11, spec §15).
 *
 * ValidationArtifacts are ephemeral attestation: full logs live
 * content-addressed in the evidence object store while the row carries the
 * tamper-evident hash. Past the retention window both go — but an object is
 * deleted ONLY when no surviving artifact references it (content addressing
 * dedupes identical logs across runs, so a naive delete would corrupt live
 * rows). Object deletion is best-effort per key; row deletion is atomic per
 * batch. Idempotent and safe to run on a schedule.
 */

/** Validation artifacts older than this are eligible for purge. */
export const DEFAULT_ARTIFACT_RETENTION_DAYS = 90;

export interface ArtifactPurgeResult {
  eligible: number;
  artifactsDeleted: number;
  objectsDeleted: number;
  objectFailures: number;
}

export async function purgeValidationArtifacts(args: {
  olderThanDays?: number;
  now?: Date;
  batchSize?: number;
}): Promise<ArtifactPurgeResult> {
  const olderThanDays = args.olderThanDays ?? DEFAULT_ARTIFACT_RETENTION_DAYS;
  const now = args.now ?? new Date();
  const batchSize = args.batchSize ?? 500;
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);

  const eligible = await prisma.validationArtifact.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, stdoutUri: true, stderrUri: true },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  let objectsDeleted = 0;
  let objectFailures = 0;
  for (const artifact of eligible) {
    const uris = [artifact.stdoutUri, artifact.stderrUri].filter(
      (uri): uri is string => typeof uri === "string" && uri.length > 0,
    );
    for (const uri of Array.from(new Set(uris))) {
      // Shared objects (identical logs, same key) survive while ANY live
      // artifact references them — including rows outside this batch.
      const liveRefs = await prisma.validationArtifact.count({
        where: {
          id: { not: artifact.id },
          OR: [{ stdoutUri: uri }, { stderrUri: uri }],
        },
      });
      if (liveRefs > 0) continue;
      try {
        if (await deleteEvidenceObject(uri)) objectsDeleted += 1;
      } catch {
        objectFailures += 1;
      }
    }
  }

  let artifactsDeleted = 0;
  if (eligible.length > 0) {
    const deleted = await prisma.validationArtifact.deleteMany({
      where: { id: { in: eligible.map((artifact) => artifact.id) } },
    });
    artifactsDeleted = deleted.count;
  }

  return {
    eligible: eligible.length,
    artifactsDeleted,
    objectsDeleted,
    objectFailures,
  };
}
