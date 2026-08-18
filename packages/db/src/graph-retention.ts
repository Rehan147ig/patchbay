import { prisma } from "./client";

/**
 * Graph snapshot retention (WP5).
 *
 * Snapshots are immutable and expensive: each READY snapshot holds nodes,
 * edges, and per-evidence rows. Retention keeps only the latest
 * MAX_READY_SNAPSHOTS per repository, deletes stale READY snapshots, and
 * clears incomplete snapshots (INDEXING/FAILED) once they are older than
 * STALE_SNAPSHOT_AGE_MS. GraphSnapshot cascades delete nodes/edges/evidence;
 * GraphIndexJob.snapshotId is set to null (kept as history), so pruning never
 * breaks job audit trails.
 */

/** Keep the latest 5 READY snapshots per repository. */
export const MAX_READY_SNAPSHOTS = 5;
/** Incomplete snapshots (INDEXING/FAILED) older than this are pruned. */
export const STALE_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  repositoryId: string;
  readyDeleted: number;
  staleDeleted: number;
  keptReady: number;
}

export async function pruneGraphSnapshots(args: {
  organizationId: string;
  repositoryId: string;
  now?: Date;
}): Promise<RetentionResult> {
  const now = args.now ?? new Date();

  const ready = await prisma.graphSnapshot.findMany({
    where: {
      organizationId: args.organizationId,
      repositoryId: args.repositoryId,
      status: "READY",
    },
    select: { id: true, completedAt: true },
    orderBy: { completedAt: "desc" },
  });

  const keepIds = new Set(ready.slice(0, MAX_READY_SNAPSHOTS).map((s) => s.id));
  const readyToDelete = ready.filter((s) => !keepIds.has(s.id)).map((s) => s.id);

  const stale = await prisma.graphSnapshot.findMany({
    where: {
      organizationId: args.organizationId,
      repositoryId: args.repositoryId,
      status: { in: ["INDEXING", "FAILED"] },
      createdAt: { lt: new Date(now.getTime() - STALE_SNAPSHOT_AGE_MS) },
    },
    select: { id: true },
  });
  const staleToDelete = stale.map((s) => s.id);

  if (readyToDelete.length > 0) {
    await prisma.graphSnapshot.deleteMany({ where: { id: { in: readyToDelete } } });
  }
  if (staleToDelete.length > 0) {
    await prisma.graphSnapshot.deleteMany({ where: { id: { in: staleToDelete } } });
  }

  return {
    repositoryId: args.repositoryId,
    readyDeleted: readyToDelete.length,
    staleDeleted: staleToDelete.length,
    keptReady: ready.length - readyToDelete.length,
  };
}
