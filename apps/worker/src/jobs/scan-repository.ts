import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, createNotification, NotificationType } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ScanStatus, logger } from "@patchbay/domain";
import { analyzeRepository } from "@patchbay/repo-analysis";
import { enqueue, JobType } from "@patchbay/queue";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";
import { resolveRepositorySource } from "../lib/repository-source";
import { getCapability } from "@patchbay/vendor-connectors";

/**
 * scan-repository processor.
 *
 * Job data is a UUID repositoryId + scanId: the web API creates the
 * RepositoryScan row (QUEUED) and enqueues the job; this processor drives it
 * RUNNING -> COMPLETED / FAILED, replaces the repository's IntegrationUsage
 * rows with fresh analyzer output (preserving any manual owner assignments),
 * and writes scan.* audit events. Deterministic and idempotent: a retry simply
 * re-runs the same replacement.
 *
 * Source resolution: fixture repositories analyze the local fixture copy;
 * GitHub-installed repositories check out the default-branch HEAD through the
 * GitHub App installation token (resolveRepositorySource). On completion the
 * next job in the pipeline, graph-index (BASELINE), is enqueued so the graph
 * snapshot stays in sync with the scanned source.
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
    after: { source: sourceLabel(repository.metadata) },
  });
  logger.info("scan started", { repositoryId, scanId, correlationId });

  try {
    const source = await resolveRepositorySource(repository);
    const rootDir = source.rootDir;
    const vendors = await prisma.vendor.findMany({ where: { enabled: true } });
    const vendorIdByPackage = new Map<string, string>();
    for (const vendor of vendors) {
      vendorIdByPackage.set(vendor.slug, vendor.id);
      const npmPackage = getCapability(vendor.slug)?.package;
      if (npmPackage) vendorIdByPackage.set(npmPackage, vendor.id);
    }
    const trackPackages = [...vendorIdByPackage.keys()];

    const analysis = await analyzeRepository({ rootDir, trackPackages });
    const commitSha = source.kind === "github" ? source.commitSha : analysis.commitSha;

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
        .filter((usage) => vendorIdByPackage.has(usage.packageName))
        .map((usage) => ({
          organizationId: repository.organizationId,
          repositoryId,
          scanId,
          vendorId: vendorIdByPackage.get(usage.packageName)!,
          filePath: usage.filePath,
          symbol: usage.symbol,
          usageType: usage.usageType,
          astLocation: { line: usage.line, column: usage.column },
          surroundingCodeHash: hashCode(usage.excerpt),
          codeExcerpt: { text: usage.excerpt, line: usage.line, column: usage.column },
          ownerHint:
            ownerByKey.get(usageKey(usage.filePath, usage.symbol, usage.usageType)) ?? "Unassigned",
          riskTags: usage.riskTags,
          metadata:
            source.kind === "github"
              ? { installationId: source.installationId }
              : { fixture: source.fixture },
        }));

      await tx.integrationUsage.deleteMany({ where: { repositoryId } });
      if (nextUsages.length > 0) {
        await tx.integrationUsage.createMany({ data: nextUsages });
      }

      // Lockfile-resolved dependency inventory (content-addressed per commit):
      // every package named in the lockfile with a resolved version, carrying
      // the merged declared range from manifests. This is the tenant-facing
      // row the release matcher (Phase E) resolves against.
      const declaredByPackage = new Map<string, string>();
      for (const manifest of analysis.manifests) {
        for (const [pkg, range] of Object.entries(manifest.dependencies)) {
          declaredByPackage.set(
            pkg,
            declaredByPackage.has(pkg) ? declaredByPackage.get(pkg)! : range,
          );
        }
        for (const [pkg, range] of Object.entries(manifest.devDependencies)) {
          declaredByPackage.set(
            pkg,
            declaredByPackage.has(pkg) ? declaredByPackage.get(pkg)! : range,
          );
        }
      }
      const dependencyRows = Object.entries(analysis.lockfileVersions).map(
        ([packageName, resolvedVersion]) => ({
          organizationId: repository.organizationId,
          repositoryId,
          packageName,
          declaredRange: declaredByPackage.get(packageName) ?? null,
          resolvedVersion,
          lockfileKind: analysis.packageManager,
          commitSha,
        }),
      );
      await tx.repositoryDependency.createMany({ data: dependencyRows, skipDuplicates: true });

      await tx.repositoryScan.update({
        where: { id: scanId },
        data: {
          status: ScanStatus.COMPLETED,
          commitSha,
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
        commitSha,
        usageCount: usages.length,
        dependencyCount: Object.keys(analysis.lockfileVersions).length,
        filesScanned: analysis.filesScanned,
        durationMs: analysis.durationMs,
        source: source.kind,
      },
    });
    await createNotification({
      organizationId,
      type: NotificationType.SCAN_COMPLETED,
      title: `Scan completed: ${repository.name}`,
      body: `${usages.length} usages indexed across ${analysis.filesScanned} files`,
      correlationId,
    });
    logger.info("scan completed", {
      repositoryId,
      scanId,
      correlationId,
      commitSha,
      usageCount: usages.length,
    });

    // Next job in the pipeline: index the graph snapshot for the same source.
    // A chaining failure must not fail the scan — the snapshot can be re-run
    // from the repository page.
    await enqueueGraphIndex(
      organizationId,
      repositoryId,
      correlationId,
      sourceLabel(repository.metadata),
    );

    return {
      scanId,
      repositoryId,
      commitSha,
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
    await createNotification({
      organizationId,
      type: NotificationType.SCAN_FAILED,
      title: `Scan failed: ${repository.name}`,
      body: String(error).slice(0, 200),
      correlationId,
    });
    logger.error("scan failed", { repositoryId, scanId, correlationId, error: String(error) });
    throw error;
  }
}

function sourceLabel(metadata: unknown): string {
  const fixture = fixtureOf(metadata);
  if (fixture) return `fixture:${fixture}`;
  return "github";
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}

/**
 * Creates the GraphIndexJob row and enqueues the next pipeline job after a
 * successful scan. Never throws: the snapshot is optional and can be re-run.
 */
async function enqueueGraphIndex(
  organizationId: string,
  repositoryId: string,
  correlationId: string,
  source: string,
): Promise<void> {
  try {
    const indexJob = await prisma.graphIndexJob.create({
      data: {
        organizationId,
        repositoryId,
        mode: "BASELINE",
        status: "INDEXING",
        correlationId,
      },
    });
    await enqueue(JobType.GRAPH_INDEX, {
      jobId: indexJob.id,
      repositoryId,
      correlationId,
      mode: "BASELINE",
    });
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.GRAPH_INDEX_QUEUED,
      entityType: "repository",
      entityId: repositoryId,
      correlationId,
      after: { jobId: indexJob.id, mode: "BASELINE", source },
    });
    logger.info("graph index queued after scan", { repositoryId, jobId: indexJob.id });
  } catch (error) {
    logger.warn("failed to enqueue graph index after scan", {
      repositoryId,
      error: String(error),
    });
  }
}

function usageKey(filePath: string, symbol: string, usageType: string): string {
  return `${filePath}|${symbol}|${usageType}`;
}

function hashCode(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
