import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma, pruneGraphSnapshots } from "@patchbay/db";
import type { Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, GraphIndexMode, logger } from "@patchbay/domain";
import {
  computeReextractionSet,
  extractGraph,
  inverseIndex,
  mergeIncrementalExtraction,
} from "@patchbay/repo-analysis";
import type { GraphEdgeFact, GraphExtraction, GraphNodeFact } from "@patchbay/repo-analysis";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";
import { resolveRepositorySource } from "../lib/repository-source";

/**
 * graph-index processor (Phase C: deterministic graph pipeline).
 *
 * Job data carries the GraphIndexJob row id (created by a web route or the
 * scan pipeline) and the repository. The processor:
 *  1. resolves the repository source (fixture copy or exact-HEAD GitHub App
 *     checkout) and vendors -> tracked package set
 *  2. runs the deterministic extractor (extractGraph)
 *  3. reuses the latest READY snapshot when the commit SHA is unchanged
 *  4. in INCREMENTAL mode, computes the conservative re-extraction set from
 *     the previous READY snapshot's reverse index (invalidation.ts), runs the
 *     extractor on those files, and merges the result with the unchanged
 *     baseline facts (merge.ts) so the new snapshot equals a clean full
 *     extraction (proven by the WP5 comparator corpus)
 *  5. persists the new immutable snapshot: nodes, edges, evidence
 *     (content-addressed; skipDuplicates makes retries idempotent)
 *  6. prunes stale snapshots (retention) and writes graph.index.* audit events
 */
export const GraphIndexJobDataSchema = z.object({
  jobId: z.string().min(1),
  repositoryId: z.string().min(1),
  correlationId: z.string().min(1),
  mode: z.enum([GraphIndexMode.BASELINE, GraphIndexMode.INCREMENTAL]),
});
export type GraphIndexJobData = z.infer<typeof GraphIndexJobDataSchema>;

const BATCH_SIZE = 10_000;
const EXTRACTOR_VERSION = 1;

/** Deterministic snapshot source hash: commit SHA + tree hash (mirrors checkout provenance). */
function snapshotSourceHash(commitSha: string, rootTreeHash: string): string {
  return createHash("sha256").update(`${commitSha}:${rootTreeHash}`).digest("hex").slice(0, 16);
}

export interface GraphIndexResult {
  jobId: string;
  repositoryId: string;
  snapshotId: string | null;
  reused: boolean;
  commitSha: string;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  mode: string;
  /** Files re-extracted in INCREMENTAL mode; null when a full extraction ran. */
  reextractedPaths: string[] | null;
  /** Snapshots pruned by retention after this run. */
  retention: { readyDeleted: number; staleDeleted: number } | null;
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
    const source = await resolveRepositorySource(repository);
    const rootDir = source.rootDir;
    const vendors = await prisma.vendor.findMany({ where: { enabled: true } });
    const trackPackages = vendors.map((vendor) => vendor.slug);

    const changedPaths = indexJob.changedPaths as string[] | null | undefined;

    // INCREMENTAL mode: load the previous READY snapshot and compute the
    // conservative re-extraction set from its reverse dependency index.
    // A manifest/lockfile/config change invalidates everything, in which case
    // we fall back to a full extraction (no merge needed).
    let baseline: GraphExtraction | null = null;
    let reextractedPaths: string[] | null = null;
    let changedFiles: Map<string, string> | undefined;
    if (mode === GraphIndexMode.INCREMENTAL && changedPaths && changedPaths.length > 0) {
      const previous = await loadPreviousSnapshotFacts(organizationId, repositoryId);
      if (previous) {
        const invalidation = computeReextractionSet({
          changedFiles: changedPaths,
          ...inverseIndex(previous),
          allFiles: previousAllFiles(previous),
        });
        if (invalidation.invalidatingManifests.length === 0) {
          baseline = previous;
          reextractedPaths = invalidation.reextract;
          changedFiles = new Map(invalidation.reextract.map((p) => [p, ""] as const));
        }
      }
    }

    const extraction = await extractGraph({ rootDir, trackPackages, changedFiles });

    const existing = await prisma.graphSnapshot.findFirst({
      where: {
        repositoryId,
        organizationId,
        commitSha: extraction.commitSha,
        extractionVersion: EXTRACTOR_VERSION,
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
        mode,
        reextractedPaths: null,
        retention: null,
      };
    }

    // Merge baseline facts with the incremental extraction when the re-extraction
    // set was a strict subset of the repository (no manifest-wide invalidation).
    const effective =
      baseline && reextractedPaths
        ? mergeIncrementalExtraction(baseline, extraction, new Set(reextractedPaths))
        : extraction;

    const snapshot = await persistSnapshot({
      organizationId,
      repositoryId,
      jobId,
      extraction: effective,
      changedPaths: indexJob.changedPaths as Prisma.InputJsonValue | undefined,
    });

    // Retention: keep only the latest READY snapshots; prune stale incomplete ones.
    let retention: GraphIndexResult["retention"] = null;
    try {
      const retentionResult = await pruneGraphSnapshots({ organizationId, repositoryId });
      retention = {
        readyDeleted: retentionResult.readyDeleted,
        staleDeleted: retentionResult.staleDeleted,
      };
    } catch (error) {
      logger.warn("graph snapshot retention failed", {
        repositoryId,
        jobId,
        error: String(error),
      });
    }

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
        reextractedPaths,
        retention,
      },
    });
    logger.info("graph index completed", {
      repositoryId,
      jobId,
      correlationId,
      snapshotId: snapshot.id,
      nodeCount: snapshot.nodesAffected,
      edgeCount: snapshot.edgesAffected,
      mode,
      reextractedPaths,
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
      mode,
      reextractedPaths,
      retention,
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

/** Every scanned source path of the previous snapshot (distinct node files). */
function previousAllFiles(previous: GraphExtraction): string[] {
  const files = new Set<string>();
  for (const node of previous.nodeFacts) {
    if (node.filePath !== null) files.add(node.filePath);
  }
  return [...files];
}

/**
 * Loads the latest READY snapshot as extraction facts so invalidation and
 * merge can reuse them. Returns null when no previous READY snapshot exists.
 */
async function loadPreviousSnapshotFacts(
  organizationId: string,
  repositoryId: string,
): Promise<GraphExtraction | null> {
  const previous = await prisma.graphSnapshot.findFirst({
    where: { organizationId, repositoryId, status: "READY" },
    select: { id: true, commitSha: true, rootTreeHash: true },
    orderBy: { completedAt: "desc" },
  });
  if (!previous) return null;

  const nodeRows = await prisma.graphNode.findMany({
    where: { organizationId, repositoryId, snapshotId: previous.id },
    select: {
      id: true,
      stableKey: true,
      kind: true,
      displayName: true,
      filePath: true,
      startLine: true,
      endLine: true,
      propertiesJson: true,
      contentHash: true,
    },
  });
  const edgeRows = await prisma.graphEdge.findMany({
    where: { organizationId, repositoryId, snapshotId: previous.id },
    select: {
      id: true,
      fromNodeId: true,
      toNodeId: true,
      kind: true,
      provenance: true,
      confidence: true,
      evidenceJson: true,
    },
  });
  const evidenceRows = await prisma.graphSourceEvidence.findMany({
    where: { organizationId, repositoryId, snapshotId: previous.id },
    select: {
      nodeId: true,
      edgeId: true,
      filePath: true,
      startLine: true,
      endLine: true,
      sourceHash: true,
      extractor: true,
      extractorVersion: true,
    },
  });

  const stableKeyById = new Map<string, string>();
  const nodeIdByKey = new Map<string, string>();
  const nodeFacts: GraphNodeFact[] = nodeRows.map((row) => {
    stableKeyById.set(row.id, row.stableKey);
    nodeIdByKey.set(row.stableKey, row.id);
    return {
      key: row.stableKey,
      kind: row.kind,
      displayName: row.displayName,
      filePath: row.filePath,
      startLine: row.startLine,
      endLine: row.endLine,
      properties: asRecord(row.propertiesJson),
      contentHash: row.contentHash,
      evidence: [],
    };
  });
  const evidenceByNodeId = new Map<string, GraphNodeFact["evidence"]>();
  const evidenceByEdgeId = new Map<string, GraphEdgeFact["evidence"]>();
  for (const row of evidenceRows) {
    const evidence = {
      filePath: row.filePath,
      startLine: row.startLine,
      endLine: row.endLine,
      sourceHash: row.sourceHash,
      extractor: row.extractor,
      extractorVersion: row.extractorVersion,
    };
    if (row.nodeId) {
      const list = evidenceByNodeId.get(row.nodeId);
      if (list) list.push(evidence);
      else evidenceByNodeId.set(row.nodeId, [evidence]);
    }
    if (row.edgeId) {
      const list = evidenceByEdgeId.get(row.edgeId);
      if (list) list.push(evidence);
      else evidenceByEdgeId.set(row.edgeId, [evidence]);
    }
  }
  for (const node of nodeFacts) {
    const nodeId = nodeIdByKey.get(node.key);
    if (nodeId) node.evidence = evidenceByNodeId.get(nodeId) ?? [];
  }

  const edgeFacts: GraphEdgeFact[] = [];
  for (const row of edgeRows) {
    const fromKey = stableKeyById.get(row.fromNodeId);
    const toKey = stableKeyById.get(row.toNodeId);
    if (!fromKey || !toKey) continue;
    const occurrences = asOccurrences(row.evidenceJson);
    const evidence = evidenceByEdgeId.get(row.id);
    edgeFacts.push({
      key: `${fromKey}|${row.kind}|${toKey}`,
      kind: row.kind,
      fromKey,
      toKey,
      provenance: row.provenance,
      confidence: row.confidence,
      properties: {},
      evidence:
        evidence && evidence.length > 0
          ? evidence
          : occurrences.map((occurrence) => ({
              filePath: occurrence.file,
              startLine: occurrence.startLine,
              endLine: occurrence.endLine,
              sourceHash: "",
              extractor: "",
              extractorVersion: "",
            })),
    });
  }

  return {
    commitSha: previous.commitSha,
    rootTreeHash: previous.rootTreeHash,
    nodeFacts,
    edgeFacts,
    errors: [],
  };
}

function asRecord(value: Prisma.JsonValue | null): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
    else out[key] = String(entry);
  }
  return out;
}

function asOccurrences(
  value: Prisma.JsonValue | null,
): Array<{ file: string; startLine: number | null; endLine: number | null }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const occurrences = (value as { occurrences?: unknown }).occurrences;
  if (!Array.isArray(occurrences)) return [];
  return occurrences.filter(isOccurrence);
}

function isOccurrence(
  value: unknown,
): value is { file: string; startLine: number | null; endLine: number | null } {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as { file?: unknown; startLine?: unknown; endLine?: unknown };
  return typeof entry.file === "string";
}

async function persistSnapshot(args: {
  organizationId: string;
  repositoryId: string;
  jobId: string;
  extraction: GraphExtraction;
  changedPaths: Prisma.InputJsonValue | undefined;
}): Promise<{ id: string; nodesAffected: number; edgesAffected: number }> {
  const { organizationId, repositoryId, jobId, extraction, changedPaths } = args;

  return prisma.$transaction(async (tx) => {
    const created = await tx.graphSnapshot.create({
      data: {
        organizationId,
        repositoryId,
        commitSha: extraction.commitSha,
        extractionVersion: EXTRACTOR_VERSION,
        status: "INDEXING",
        rootTreeHash: extraction.rootTreeHash,
        sourceHash: snapshotSourceHash(extraction.commitSha, extraction.rootTreeHash),
        changedPaths,
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
      const edgeId = edgeIds.get(`${edgeFact.kind}|${edgeFact.fromKey}|${edgeFact.toKey}`) ?? null;
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
          },
          completedAt: new Date(),
        },
      }),
    ]);
    return {
      id: updated.id,
      nodesAffected: updated.nodesAffected,
      edgesAffected: updated.edgesAffected,
    };
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
