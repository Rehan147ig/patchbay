import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ScanStatus, logger } from "@patchbay/domain";
import { analyzeRepository, resolveFixtureDir } from "@patchbay/repo-analysis";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

/**
 * scan-repository processor.
 *
 * Job data is a UUID repositoryId + scanId: the web API creates the
 * RepositoryScan row (QUEUED) and enqueues the job; this processor drives it
 * RUNNING -> COMPLETED / FAILED, replaces the repository's IntegrationUsage
 * rows with fresh analyzer output (preserving any manual owner assignments),
 * and writes scan.* audit events. Deterministic and idempotent: a retry simply
 * re-runs the same replacement.
 */
export const ScanRepositoryJobDataSchema = z.object({
  repositoryId: z.string().min(1),
  scanId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type ScanRepositoryJobData = z.infer<typeof ScanRepositoryJobDataSchema>;

export interface ScanRepositoryResult {
  scanId: string;
  repositoryId: string;
  commitSha: string;
  usageCount: number;
  durationMs: number;
}

export async function processScanRepository(job: Job): Promise<ScanRepositoryResult> {
  const parsed = ScanRepositoryJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid scan-repository job data: ${parsed.error.message}`);
  }
  const { repositoryId, scanId, correlationId } = parsed.data;

  const [repository, scan] = await Promise.all([
    prisma.repository.findUnique({ where: { id: repositoryId } }),
    prisma.repositoryScan.findUnique({ where: { id: scanId } }),
  ]);
  if (!repository) {
    throw new Error(`repository not found: ${repositoryId}`);
  }
  if (!scan) {
    throw new Error(`scan not found: ${scanId}`);
  }
  // Integrity check: the scan must reference this repository. Prevents a
  // mismatched job from replacing one repository's usage data with another's.
  if (scan.repositoryId !== repositoryId) {
    throw new Error(
      `scan ${scanId} does not belong to repository ${repositoryId} (repositoryId=${scan.repositoryId})`,
    );
  }

  const organizationId = repository.organizationId;
  const entity = { entityType: "repository", entityId: repositoryId };
  const startedAt = new Date();

  await prisma.repositoryScan.update({
    where: { id: scanId },
    data: { status: ScanStatus.RUNNING, startedAt },
  });
  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.SCAN_STARTED,
    correlationId,
    ...entity,
    after: { fixture: fixtureOf(repository.metadata) },
  });
  logger.info("scan started", { repositoryId, scanId, correlationId });

  try {
    const fixture = fixtureOf(repository.metadata);
    if (!fixture) {
      throw new Error(`repository ${repositoryId} has no fixture metadata`);
    }
    const fixtureDir = resolveFixtureDir(fixture);
    const vendors = await prisma.vendor.findMany({ where: { enabled: true } });
    const vendorBySlug = new Map(vendors.map((vendor) => [vendor.slug, vendor.id]));
    const trackPackages = [...vendorBySlug.keys()];

    const analysis = await analyzeRepository({ rootDir: fixtureDir, trackPackages });

    // Read existing usages (for owner hints) and replace them inside a single
    // transaction so a concurrent scan cannot interleave between the read and
    // the delete/create — otherwise owner hints can be lost or stale rows
    // merged with fresh ones.
    const usages = await prisma.$transaction(async (tx) => {
      const existing = await tx.integrationUsage.findMany({
        where: { repositoryId },
        select: { filePath: true, symbol: true, usageType: true, ownerHint: true },
      });
      const ownerByKey = new Map(
        existing.map((usage) => [
          usageKey(usage.filePath, usage.symbol, usage.usageType),
          usage.ownerHint,
        ]),
      );

      const nextUsages = analysis.usages
        .filter((usage) => vendorBySlug.has(usage.packageName))
        .map((usage) => ({
          organizationId: repository.organizationId,
          repositoryId,
          scanId,
          vendorId: vendorBySlug.get(usage.packageName)!,
          filePath: usage.filePath,
          symbol: usage.symbol,
          usageType: usage.usageType,
          astLocation: { line: usage.line, column: usage.column },
          surroundingCodeHash: hashCode(usage.excerpt),
          codeExcerpt: { text: usage.excerpt, line: usage.line, column: usage.column },
          ownerHint:
            ownerByKey.get(usageKey(usage.filePath, usage.symbol, usage.usageType)) ?? "Unassigned",
          riskTags: usage.riskTags,
          metadata: { fixture },
        }));

      await tx.integrationUsage.deleteMany({ where: { repositoryId } });
      if (nextUsages.length > 0) {
        await tx.integrationUsage.createMany({ data: nextUsages });
      }
      await tx.repositoryScan.update({
        where: { id: scanId },
        data: {
          status: ScanStatus.COMPLETED,
          commitSha: analysis.commitSha,
          completedAt: new Date(),
          summary: {
            usageCount: nextUsages.length,
            filesScanned: analysis.filesScanned,
            typescriptFiles: analysis.typescriptFiles,
            packageCount: analysis.packageCount,
            packageManager: analysis.packageManager,
            untrackedUsages: analysis.untrackedUsages,
            durationMs: analysis.durationMs,
          },
          error: null,
        },
      });
      return nextUsages;
    });

    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.SCAN_COMPLETED,
      correlationId,
      ...entity,
      after: {
        commitSha: analysis.commitSha,
        usageCount: usages.length,
        filesScanned: analysis.filesScanned,
        durationMs: analysis.durationMs,
      },
    });
    logger.info("scan completed", {
      repositoryId,
      scanId,
      correlationId,
      commitSha: analysis.commitSha,
      usageCount: usages.length,
    });

    return {
      scanId,
      repositoryId,
      commitSha: analysis.commitSha,
      usageCount: usages.length,
      durationMs: analysis.durationMs,
    };
  } catch (error) {
    await prisma.repositoryScan.update({
      where: { id: scanId },
      data: {
        status: ScanStatus.FAILED,
        error: String(error),
        completedAt: new Date(),
      },
    });
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.SCAN_FAILED,
      correlationId,
      ...entity,
      metadata: { error: String(error) },
    });
    logger.error("scan failed", { repositoryId, scanId, correlationId, error: String(error) });
    throw error;
  }
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}

function usageKey(filePath: string, symbol: string, usageType: string): string {
  return `${filePath}|${symbol}|${usageType}`;
}

function hashCode(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
