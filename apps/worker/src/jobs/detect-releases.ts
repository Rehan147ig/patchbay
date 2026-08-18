import { z } from "zod";
import { prisma, Prisma, storeRawEvidence } from "@patchbay/db";
import { logger, ActorType } from "@patchbay/domain";
import { AuditAction } from "@patchbay/audit";
import type { Job } from "bullmq";
import {
  authenticityForSource,
  getWatchtowerAdapters,
  TrustViolationError,
  validateAdapterCursor,
  type AdapterCursor,
  type WatchtowerAdapter,
  type WatchtowerEvidence,
} from "@patchbay/vendor-connectors";
import { writeAuditEvent } from "../lib/audit";

export const DetectReleasesJobDataSchema = z.object({
  adapterSlugs: z.array(z.string()).optional(),
  /** Cap on evidence items processed per adapter per run (poll sanity bound). */
  batchSize: z.number().int().positive().max(50).optional(),
  correlationId: z.string().min(1),
});
export type DetectReleasesJobData = z.infer<typeof DetectReleasesJobDataSchema>;

const DEFAULT_BATCH_SIZE = 10;

/**
 * Watchtower runs are global (not org-scoped), but audit events carry an
 * organizationId FK. All watchtower system events are recorded against this
 * dedicated system organization, upserted lazily on first use.
 */
const WATCHTOWER_ORG_ID = "org-watchtower";

let watchtowerOrgId: string | null = null;

async function watchtowerSystemOrgId(): Promise<string> {
  if (watchtowerOrgId) return watchtowerOrgId;
  const org = await prisma.organization.upsert({
    where: { id: WATCHTOWER_ORG_ID },
    update: {},
    create: { id: WATCHTOWER_ORG_ID, name: "Patchbay Watchtower" },
  });
  watchtowerOrgId = org.id;
  return org.id;
}

export async function processDetectReleases(job: Job): Promise<void> {
  const parsed = DetectReleasesJobDataSchema.safeParse(job.data);
  if (!parsed.success) throw new Error(`invalid detect-releases job data: ${parsed.error.message}`);
  const { adapterSlugs, batchSize, correlationId } = parsed.data;

  const adapters = adapterSlugs
    ? (adapterSlugs
        .map((s) => getWatchtowerAdapters().find((a) => a.slug === s))
        .filter(Boolean) as WatchtowerAdapter[])
    : getWatchtowerAdapters();

  if (adapters.length === 0) {
    logger.warn("no watchtower adapters configured");
    return;
  }

  // Each adapter polls independently: a rejection, timeout, or crash in one
  // adapter must never stop the others (acceptance criterion).
  for (const adapter of adapters) {
    await pollAdapter(adapter, { batchSize: batchSize ?? DEFAULT_BATCH_SIZE, correlationId });
  }
}

interface PollOptions {
  batchSize: number;
  correlationId: string;
}

async function pollAdapter(adapter: WatchtowerAdapter, options: PollOptions): Promise<void> {
  const { correlationId } = options;
  const lastRun = await prisma.detectionRun.findFirst({
    where: { adapter: adapter.slug, status: "COMPLETED", cursor: { not: Prisma.JsonNull } },
    orderBy: { completedAt: "desc" },
    select: { cursor: true },
  });
  const lastCursor = lastRun?.cursor as AdapterCursor | undefined;

  // Trust gate 1: the persisted cursor must be a well-formed JSON object of the
  // shape this adapter produces. A malformed cursor fails the run and is
  // audited instead of being replayed into adapter state.
  const cursorViolations = validateAdapterCursor(adapter.slug, lastCursor);
  if (cursorViolations.length > 0) {
    await rejectRun(
      adapter.slug,
      "cursor_invalid",
      `malformed persisted cursor: ${cursorViolations.join("; ")}`,
      options,
      { cursor: lastCursor },
    );
    return;
  }

  const run = await prisma.detectionRun.create({
    data: {
      adapter: adapter.slug,
      status: "RUNNING",
      cursor: (lastCursor as Prisma.InputJsonValue | undefined) ?? undefined,
    },
  });
  const startedAt = Date.now();

  try {
    await auditWatchtower(
      ActorType.SYSTEM,
      AuditAction.DETECTION_RUN_STARTED,
      run.id,
      correlationId,
      {
        adapter: adapter.slug,
      },
    );

    const poll = await adapter.fetch(lastCursor ?? {});
    const evidence = poll.evidence.slice(0, options.batchSize);
    let observedCount = 0;
    for (const ev of evidence) {
      await observeEvidence(ev, correlationId);
      observedCount += 1;
    }

    const latencyMs = Date.now() - startedAt;
    await prisma.detectionRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        observedCount,
        latencyMs,
        cursor: poll.cursor as Prisma.InputJsonValue,
      },
    });

    await auditWatchtower(
      ActorType.SYSTEM,
      AuditAction.DETECTION_RUN_COMPLETED,
      run.id,
      correlationId,
      {
        adapter: adapter.slug,
        observedCount,
        latencyMs,
      },
    );

    logger.info("detection run completed", {
      adapter: adapter.slug,
      runId: run.id,
      correlationId,
      observedCount,
      latencyMs,
    });
  } catch (error) {
    // Trust gate 2: classify trust violations (domain, redirect, size, timeout)
    // separately from generic failures so health views can show why a detector
    // was rejected rather than merely failing.
    const runError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const rejectionReason = error instanceof TrustViolationError ? error.reason : null;
    await prisma.detectionRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: runError,
        latencyMs: Date.now() - startedAt,
        rejectionReason,
        observedCount: 0,
      },
    });

    if (rejectionReason) {
      await auditWatchtower(
        ActorType.SYSTEM,
        AuditAction.DETECTION_POLL_REJECTED,
        run.id,
        correlationId,
        {
          adapter: adapter.slug,
          reason: rejectionReason,
          error: runError,
        },
      );
    } else {
      await auditWatchtower(
        ActorType.SYSTEM,
        AuditAction.DETECTION_RUN_FAILED,
        run.id,
        correlationId,
        {
          adapter: adapter.slug,
          error: runError,
        },
      );
    }

    logger.error("detection run failed", {
      adapter: adapter.slug,
      runId: run.id,
      error: runError,
      rejectionReason,
    });
  }
}

/**
 * Fail the run before it ever starts (e.g. malformed persisted cursor) and
 * record a rejected-poll audit event.
 */
async function rejectRun(
  adapter: string,
  reason: string,
  message: string,
  options: PollOptions,
  metadata: Record<string, unknown>,
): Promise<void> {
  const run = await prisma.detectionRun.create({
    data: {
      adapter,
      status: "FAILED",
      completedAt: new Date(),
      error: message,
      rejectionReason: reason,
      observedCount: 0,
    },
  });
  await auditWatchtower(
    ActorType.SYSTEM,
    AuditAction.DETECTION_POLL_REJECTED,
    run.id,
    options.correlationId,
    {
      adapter,
      reason,
      error: message,
      ...metadata,
    },
  );
  logger.warn("detection poll rejected", { adapter, runId: run.id, reason, error: message });
}

async function observeEvidence(ev: WatchtowerEvidence, correlationId: string) {
  // Check if we already hold this release globally (content hash dedupe).
  const existingRelease = await prisma.releaseRecord.findFirst({
    where: {
      product: { packageName: ev.packageName, vendor: { slug: ev.vendorSlug } },
      version: ev.version,
      contentHash: ev.contentHash,
    },
    select: { id: true },
  });
  if (existingRelease) {
    // Reconcile: newer polls may learn a previously unknown predecessor.
    await prisma.releaseRecord.updateMany({
      where: { id: existingRelease.id, previousVersion: null },
      data: { previousVersion: ev.previousVersion ?? null },
    });
    return;
  }

  // Trust gate 3: the raw payload is stored verbatim in the content-addressed
  // evidence object store; the database row keeps only the object key and
  // content hash. Same content -> same key -> no duplicate writes.
  let objectStorageKey: string;
  if (ev.rawPayload !== undefined) {
    const stored = await storeRawEvidence(ev.rawPayload);
    objectStorageKey = stored.key;
  } else {
    objectStorageKey = `evidence/${ev.externalId}.json`;
  }

  const vendor = await prisma.vendor.upsert({
    where: { slug: ev.vendorSlug },
    update: {},
    create: { slug: ev.vendorSlug, name: ev.vendorSlug, category: "SDK", enabled: true },
  });

  const product = await prisma.vendorProduct.upsert({
    where: {
      vendorId_ecosystem_packageName: {
        vendorId: vendor.id,
        ecosystem: "npm",
        packageName: ev.packageName,
      },
    },
    update: {},
    create: {
      vendorId: vendor.id,
      ecosystem: "npm",
      packageName: ev.packageName,
    },
  });

  const release = await prisma.releaseRecord.create({
    data: {
      productId: product.id,
      source: ev.source,
      version: ev.version,
      previousVersion: ev.previousVersion ?? null,
      publishedAt: ev.publishedAt,
      canonicalUrl: ev.canonicalUrl ?? "",
      contentHash: ev.contentHash,
      // OpenAPI diffs are observations, never trusted releases; npm/GitHub
      // evidence passes the trust profile so it is source-trusted.
      authenticity: authenticityForSource(ev.source),
      status: "OBSERVED",
    },
  });

  await prisma.releaseEvidence.create({
    data: {
      releaseRecordId: release.id,
      kind: ev.source,
      objectStorageKey,
      contentHash: ev.contentHash,
      metadataJson: {
        externalId: ev.externalId,
        vendorSlug: ev.vendorSlug,
        packageName: ev.packageName,
        version: ev.version,
        previousVersion: ev.previousVersion ?? null,
        canonicalUrl: ev.canonicalUrl ?? null,
        publishedAt: ev.publishedAt.toISOString(),
        metadata: ev.metadata ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  await enqueueClassifyAndMatch(release.id, correlationId);
}

async function auditWatchtower(
  actorType: (typeof ActorType)[keyof typeof ActorType],
  action: (typeof AuditAction)[keyof typeof AuditAction],
  runId: string,
  correlationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const organizationId = await watchtowerSystemOrgId();
  await writeAuditEvent({
    organizationId,
    actorType,
    actorId: null,
    action,
    entityType: "detection_run",
    entityId: runId,
    correlationId,
    metadata,
  });
}

// Import here to avoid circular dependency
async function enqueueClassifyAndMatch(releaseId: string, correlationId: string) {
  const { enqueue, JobType } = await import("@patchbay/queue");
  await enqueue(JobType.CLASSIFY_RELEASE, { releaseId, correlationId });
  await enqueue(JobType.MATCH_RELEASE, { releaseId, correlationId });
}
