import { z } from "zod";
import { prisma, Prisma } from "@patchbay/db";
import { logger } from "@patchbay/domain";
import type { Job } from "bullmq";
import {
  getWatchtowerAdapters,
  type AdapterCursor,
  type WatchtowerAdapter,
  type WatchtowerEvidence,
} from "@patchbay/vendor-connectors";

export const DetectReleasesJobDataSchema = z.object({
  adapterSlugs: z.array(z.string()).optional(),
  /** Cap on evidence items processed per adapter per run (poll sanity bound). */
  batchSize: z.number().int().positive().max(50).optional(),
  correlationId: z.string().min(1),
});
export type DetectReleasesJobData = z.infer<typeof DetectReleasesJobDataSchema>;

const DEFAULT_BATCH_SIZE = 10;

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

  for (const adapter of adapters) {
    const lastRun = await prisma.detectionRun.findFirst({
      where: { adapter: adapter.slug, status: "COMPLETED", cursor: { not: Prisma.JsonNull } },
      orderBy: { completedAt: "desc" },
      select: { cursor: true },
    });

    const run = await prisma.detectionRun.create({
      data: {
        adapter: adapter.slug,
        status: "RUNNING",
        cursor: (lastRun?.cursor as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });

    let observedCount = 0;

    try {
      const poll = await adapter.fetch((lastRun?.cursor as AdapterCursor | undefined) ?? {});
      const evidence = poll.evidence.slice(0, batchSize ?? DEFAULT_BATCH_SIZE);
      observedCount = evidence.length;

      for (const ev of evidence) {
        await observeEvidence(ev, correlationId);
      }

      await prisma.detectionRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          observedCount,
          cursor: poll.cursor as Prisma.InputJsonValue,
        },
      });

      logger.info("detection run completed", {
        adapter: adapter.slug,
        runId: run.id,
        correlationId,
        observedCount,
      });
    } catch (error) {
      const runError = String(error);
      await prisma.detectionRun.update({
        where: { id: run.id },
        data: { status: "FAILED", completedAt: new Date(), error: runError, observedCount },
      });
      logger.error("detection run failed", {
        adapter: adapter.slug,
        runId: run.id,
        error: runError,
      });
    }
  }
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
      source: adapterSource(ev),
      version: ev.version,
      previousVersion: ev.previousVersion ?? null,
      publishedAt: ev.publishedAt,
      canonicalUrl: ev.canonicalUrl ?? "",
      contentHash: ev.contentHash,
      status: "OBSERVED",
    },
  });

  await prisma.releaseEvidence.create({
    data: {
      releaseRecordId: release.id,
      kind: adapterSource(ev),
      objectStorageKey: `evidence/${ev.externalId}.json`,
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

function adapterSource(ev: WatchtowerEvidence) {
  return ev.source;
}

// Import here to avoid circular dependency
async function enqueueClassifyAndMatch(releaseId: string, correlationId: string) {
  const { enqueue, JobType } = await import("@patchbay/queue");
  await enqueue(JobType.CLASSIFY_RELEASE, { releaseId, correlationId });
  await enqueue(JobType.MATCH_RELEASE, { releaseId, correlationId });
}
