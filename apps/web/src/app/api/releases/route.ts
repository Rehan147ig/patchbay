import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { validationFailed } from "@patchbay/domain";
import { enqueue, JobType } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

const CreateReleaseSchema = z.object({
  vendorSlug: z.string().min(1),
  packageName: z.string().min(1),
  version: z.string().min(1),
  previousVersion: z.string().optional(),
  source: z
    .enum(["NPM", "GITHUB_RELEASE", "OPENAPI", "VENDOR_MANIFEST", "CHANGELOG"])
    .default("NPM"),
  sourceUrl: z.string().url().optional(),
});

/**
 * POST /api/releases — record an observed upstream release (the missing
 * ReleaseRecord writer). Creates the release (content-addressed identity),
 * classifies it deterministically (Phase E), and matches it against every
 * repository's dependency inventory, all via the worker queue.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const body = CreateReleaseSchema.parse(await request.json());

    const vendor = await prisma.vendor.findUnique({
      where: { slug: body.vendorSlug },
      select: { id: true },
    });
    if (!vendor) {
      throw validationFailed(`Vendor not found: ${body.vendorSlug}`);
    }

    const product = await prisma.vendorProduct.upsert({
      where: {
        vendorId_ecosystem_packageName: {
          vendorId: vendor.id,
          ecosystem: "npm",
          packageName: body.packageName,
        },
      },
      create: { vendorId: vendor.id, ecosystem: "npm", packageName: body.packageName },
      update: {},
    });

    const contentHash = createHash("sha256")
      .update(`${body.source}|${body.vendorSlug}|${body.packageName}|${body.version}`)
      .digest("hex");

    let duplicate = false;
    const release = await prisma.releaseRecord
      .create({
        data: {
          productId: product.id,
          source: body.source,
          version: body.version,
          previousVersion: body.previousVersion ?? null,
          publishedAt: new Date(),
          canonicalUrl: body.sourceUrl ?? "",
          contentHash,
        },
      })
      .catch((error: unknown) => {
        const known =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: string }).code
            : undefined;
        if (known === "P2002") {
          duplicate = true;
          return prisma.releaseRecord.findFirst({
            where: {
              productId: product.id,
              source: body.source,
              version: body.version,
              contentHash,
            },
          });
        }
        throw error;
      });

    if (!release) {
      throw validationFailed("Release could not be recorded");
    }

    if (!duplicate) {
      await enqueue(JobType.CLASSIFY_RELEASE, { releaseId: release.id, correlationId });
      await enqueue(JobType.MATCH_RELEASE, { releaseId: release.id, correlationId });
    }

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user.id,
      action: AuditAction.RELEASE_RECORDED,
      entityType: "releaseRecord",
      entityId: release.id,
      correlationId,
      after: {
        vendorSlug: body.vendorSlug,
        packageName: body.packageName,
        version: body.version,
        previousVersion: body.previousVersion ?? null,
      },
    });

    return jsonOk(
      {
        releaseId: release.id,
        packageName: body.packageName,
        version: body.version,
        status: "OBSERVED",
        classified: false,
        duplicate,
      },
      correlationId,
      duplicate ? 200 : 201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

/**
 * GET /api/releases — releases with classification + per-org match counts,
 * newest first, bounded page.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");

    const [releases, matchCounts] = await Promise.all([
      prisma.releaseRecord.findMany({
        orderBy: { publishedAt: "desc" },
        take: 50,
        include: {
          product: { select: { packageName: true, vendor: { select: { slug: true } } } },
          classifications: true,
        },
      }),
      prisma.releaseRepositoryMatch.groupBy({
        by: ["releaseRecordId"],
        where: { organizationId: user.organizationId },
        _count: { _all: true },
      }),
    ]);
    const countByRelease = new Map(
      matchCounts.map((row) => [row.releaseRecordId, row._count._all]),
    );

    return jsonOk(
      {
        releases: releases.map((release) => ({
          id: release.id,
          packageName: release.product.packageName,
          vendorSlug: release.product.vendor.slug,
          version: release.version,
          previousVersion: release.previousVersion,
          source: release.source,
          publishedAt: release.publishedAt,
          status: release.status,
          breaking:
            release.classifications[0]?.factsJson !== null
              ? ((release.classifications[0]?.factsJson as { breaking?: boolean } | null)
                  ?.breaking ?? null)
              : null,
          requiresHumanReview: release.classifications[0]?.requiresHumanReview ?? false,
          matchedRepositories: countByRelease.get(release.id) ?? 0,
        })),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
