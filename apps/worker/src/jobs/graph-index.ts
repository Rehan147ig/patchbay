import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@patchbay/db";
import type { Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, GraphIndexMode, logger } from "@patchbay/domain";
import { extractGraph, resolveFixtureDir } from "@patchbay/repo-analysis";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

/**
 * graph-index processor (Phase C: deterministic graph pipeline).
 *
 * Job data carries the GraphIndexJob row id (created by a web route) and the
 * repository. The processor:
 *  1. loads the repository fixture and vendors -> tracked package set
 *  2. runs the deterministic extractor (extractGraph)
 *  3. reuses the latest READY snapshot when the commit SHA is unchanged
 *  4. otherwise persists a new immutable snapshot: nodes, edges, evidence
 *     (content-addressed; skipDuplicates makes retries idempotent)
 *  5. writes graph.index.* audit events
 */
export const GraphIndexJobDataSchema = z.object({
  jobId: z.string().min(1),
  repositoryId: z.string().min(1),
  correlationId: z.string().min(1),
  mode: z.enum([GraphIndexMode.BASELINE, GraphIndexMode.INCREMENTAL]),
});
export type GraphIndexJobData = z.infer<typeof GraphIndexJobDataSchema>;

const BATCH_SIZE = 10_000;

export interface GraphIndexResult {
  jobId: string;
  repositoryId: string;
  snapshotId: string | null;
  reused: boolean;
  commitSha: string;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
}

export async function processGraphIndex(job: Job): Promise<GraphIndexResult> {
  const parsed = GraphIndexJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid graph-index job data: ${parsed.error.message}`);
  }
  const { jobId, repositoryId, correlationId, mode } = parsed.data;

  const [repository, indexJob] = await Promise.all([
    prisma.repository.findUnique({ where: { id: repositoryId } }),
    prisma.graphIndexJob.findUnique({ where: { id: jobId } }),
  ]);
  if (!repository) {
    throw new Error(`repository not found: ${repositoryId}`);
  }
  if (!indexJob) {
    throw new Error(`graph index job not found: ${jobId}`);
  }
  if (indexJob.repositoryId !== repositoryId) {
    throw new Error(
      `graph index job ${jobId} does not belong to repository ${repositoryId} (repositoryId=${indexJob.repositoryId})`,
    );
  }

  const organizationId = repository.organizationId;
  const entity = { entityType: "repository", entityId: repositoryId };
  const startedAt = new Date();

  await prisma.graphIndexJob.update({
    where: { id: jobId },
    data: { status: "INDEXING", startedAt },
  });
  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.GRAPH_INDEX_STARTED,
    correlationId,
    ...entity,
    after: { jobId, mode },
  });
  logger.info("graph index started", { repositoryId, jobId, correlationId, mode });

  try {
    const fixture = fixtureOf(repository.metadata);
    if (!fixture) {
      throw new Error(`repository ${repositoryId} has no fixture metadata`);
    }
    const fixtureDir = resolveFixtureDir(fixture);
    const vendors = await prisma.vendor.findMany({ where: { enabled: true } });
    const trackPackages = vendors.map((vendor) => vendor.slug);

    // Incremental mode re-extracts only the changed paths from the index job;
    // unchanged files retain their prior snapshot facts (merged by the caller
    // across snapshots by matching contentHash).
    const changedPaths = indexJob.changedPaths as string[] | null | undefined;
    const changedFiles =
      mode === GraphIndexMode.INCREMENTAL && changedPaths && changedPaths.length > 0
        ? new Map(changedPaths.map((p) => [p, ""] as const))
        : undefined;

    const extraction = await extractGraph({ rootDir: fixtureDir, trackPackages, changedFiles });

    const existing = await prisma.graphSnapshot.findFirst({
      where: {
        repositoryId,
        organizationId,
        commitSha: extraction.commitSha,
        extractionVersion: 1,
        status: "READY",
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      await prisma.graphIndexJob.update({
        where: { id: jobId },
        data: {
          status: "READY",
          snapshotId: existing.id,
          timingsJson: {
            commitSha: extraction.commitSha,
            nodeCount: extraction.nodeFacts.length,
            edgeCount: extraction.edgeFacts.length,
          },
          completedAt: new Date(),
        },
      });
      await writeAuditEvent({
        organizationId,
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: AuditAction.GRAPH_INDEX_REUSED,
        correlationId,
        ...entity,
        after: { jobId, snapshotId: existing.id, commitSha: extraction.commitSha, mode },
      });
      logger.info("graph snapshot reused", { repositoryId, jobId, snapshotId: existing.id });
      return {
        jobId,
        repositoryId,
        snapshotId: existing.id,
        reused: true,
        commitSha: extraction.commitSha,
        nodeCount: extraction.nodeFacts.length,
        edgeCount: extraction.edgeFacts.length,
        durationMs: 0,
      };
    }

    const snapshot = await prisma.$transaction(async (tx) => {
      const created = await tx.graphSnapshot.create({
        data: {
          organizationId,
          repositoryId,
          commitSha: extraction.commitSha,
          extractionVersion: 1,
          status: "INDEXING",
          rootTreeHash: extraction.rootTreeHash,
          changedPaths: indexJob.changedPaths as Prisma.InputJsonValue | undefined,
        },
      });

      const nodeIds = new Map<string, string>();
      const nodeRows = extraction.nodeFacts.map((fact) => {
        const id = randomUUID();
        nodeIds.set(fact.key, id);
        return {
          id,
          organizationId,
          repositoryId,
          snapshotId: created.id,
          kind: fact.kind,
          stableKey: fact.key,
          displayName: fact.displayName,
          filePath: fact.filePath,
          startLine: fact.startLine,
          endLine: fact.endLine,
          propertiesJson: Object.keys(fact.properties).length > 0 ? fact.properties : undefined,
          contentHash: fact.contentHash,
        };
      });
      for (const chunk of chunks(nodeRows, BATCH_SIZE)) {
        await tx.graphNode.createMany({ data: chunk, skipDuplicates: true });
      }

      const edgeIds = new Map<string, string>();
      const edgeRows = extraction.edgeFacts.flatMap((fact) => {
        const fromNodeId = nodeIds.get(fact.fromKey);
        const toNodeId = nodeIds.get(fact.toKey);
        if (!fromNodeId || !toNodeId) return [];
        const id = randomUUID();
        edgeIds.set(`${fact.kind}|${fact.fromKey}|${fact.toKey}`, id);
        const occurrences = fact.evidence.map((ev) => ({
          file: ev.filePath,
          startLine: ev.startLine,
          endLine: ev.endLine,
        }));
        return [
          {
            id,
            organizationId,
            repositoryId,
            snapshotId: created.id,
            fromNodeId,
            toNodeId,
            kind: fact.kind,
            provenance: fact.provenance,
            confidence: fact.confidence,
            evidenceJson: occurrences.length > 0 ? { occurrences } : undefined,
          },
        ];
      });
      for (const chunk of chunks(edgeRows, BATCH_SIZE)) {
        await tx.graphEdge.createMany({ data: chunk, skipDuplicates: true });
      }

      const evidenceRows: Array<{
        organizationId: string;
        repositoryId: string;
        snapshotId: string;
        nodeId?: string;
        edgeId?: string;
        filePath: string;
        startLine: number | null;
        endLine: number | null;
        extractor: string;
        extractorVersion: string;
        sourceHash: string;
      }> = [];
      for (const nodeFact of extraction.nodeFacts) {
        const nodeId = nodeIds.get(nodeFact.key);
        for (const ev of nodeFact.evidence) {
          evidenceRows.push({
            organizationId,
            repositoryId,
            snapshotId: created.id,
            nodeId,
            filePath: ev.filePath,
            startLine: ev.startLine,
            endLine: ev.endLine,
            extractor: ev.extractor,
            extractorVersion: ev.extractorVersion,
            sourceHash: ev.sourceHash,
          });
        }
      }
      for (const edgeFact of extraction.edgeFacts) {
        const edgeId =
          edgeIds.get(`${edgeFact.kind}|${edgeFact.fromKey}|${edgeFact.toKey}`) ?? null;
        for (const ev of edgeFact.evidence) {
          evidenceRows.push({
            organizationId,
            repositoryId,
            snapshotId: created.id,
            edgeId: edgeId ?? undefined,
            filePath: ev.filePath,
            startLine: ev.startLine,
            endLine: ev.endLine,
            extractor: ev.extractor,
            extractorVersion: ev.extractorVersion,
            sourceHash: ev.sourceHash,
          });
        }
      }
      for (const chunk of chunks(evidenceRows, BATCH_SIZE)) {
        await tx.graphSourceEvidence.createMany({ data: chunk, skipDuplicates: true });
      }

      const [updated] = await Promise.all([
        tx.graphSnapshot.update({
          where: { id: created.id },
          data: {
            status: "READY",
            nodesAffected: nodeRows.length,
            edgesAffected: edgeRows.length,
            completedAt: new Date(),
          },
        }),
        tx.graphIndexJob.update({
          where: { id: jobId },
          data: {
            status: "READY",
            snapshotId: created.id,
            timingsJson: {
              commitSha: extraction.commitSha,
              nodeCount: nodeRows.length,
              edgeCount: edgeRows.length,
              extractionMs: Date.now() - startedAt.getTime(),
            },
            completedAt: new Date(),
          },
        }),
      ]);
      return updated;
    });

    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.GRAPH_INDEX_COMPLETED,
      correlationId,
      ...entity,
      after: {
        jobId,
        snapshotId: snapshot.id,
        commitSha: extraction.commitSha,
        mode,
        nodeCount: snapshot.nodesAffected,
        edgeCount: snapshot.edgesAffected,
      },
    });
    logger.info("graph index completed", {
      repositoryId,
      jobId,
      correlationId,
      snapshotId: snapshot.id,
      nodeCount: snapshot.nodesAffected,
      edgeCount: snapshot.edgesAffected,
    });

    return {
      jobId,
      repositoryId,
      snapshotId: snapshot.id,
      reused: false,
      commitSha: extraction.commitSha,
      nodeCount: snapshot.nodesAffected,
      edgeCount: snapshot.edgesAffected,
      durationMs: Date.now() - startedAt.getTime(),
    };
  } catch (error) {
    await prisma.graphIndexJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: String(error).slice(0, 2_000), completedAt: new Date() },
    });
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.GRAPH_INDEX_FAILED,
      correlationId,
      ...entity,
      after: { jobId, mode },
      metadata: { error: String(error) },
    });
    logger.error("graph index failed", {
      repositoryId,
      jobId,
      correlationId,
      error: String(error),
    });
    throw error;
  }
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
