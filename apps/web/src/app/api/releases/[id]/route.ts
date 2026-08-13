import { prisma, packageImpact } from "@patchbay/db";
import { validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/releases/[id] — release detail with classification facts, the
 * repositories it matched, and why-affected graph evidence per repository.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const release = await prisma.releaseRecord.findUnique({
      where: { id },
      include: {
        product: { select: { packageName: true, vendor: { select: { slug: true, name: true } } } },
        classifications: true,
      },
    });
    if (!release) {
      throw validationFailed("Release not found");
    }

    const matches = await prisma.releaseRepositoryMatch.findMany({
      where: { releaseRecordId: release.id, organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        repository: { select: { id: true, name: true, fullName: true } },
        dependency: {
          select: {
            packageName: true,
            declaredRange: true,
            resolvedVersion: true,
            commitSha: true,
          },
        },
      },
    });

    const evidence = [];
    for (const match of matches) {
      const impact = await packageImpact({
        organizationId: user.organizationId,
        repositoryId: match.repositoryId,
        packageName: release.product.packageName,
      });
      evidence.push({
        repositoryId: match.repositoryId,
        repositoryName: match.repository.name,
        matchReason: match.matchReason,
        affectedVersionRange: match.affectedVersionRange,
        resolvedVersion: match.dependency.resolvedVersion,
        declaredRange: match.dependency.declaredRange,
        impact,
      });
    }

    return jsonOk(
      {
        release: {
          id: release.id,
          packageName: release.product.packageName,
          vendorSlug: release.product.vendor.slug,
          vendorName: release.product.vendor.name,
          version: release.version,
          previousVersion: release.previousVersion,
          source: release.source,
          publishedAt: release.publishedAt,
          canonicalUrl: release.canonicalUrl,
          status: release.status,
          classification: release.classifications[0]
            ? {
                method: release.classifications[0].method,
                factsJson: release.classifications[0].factsJson,
                confidence: release.classifications[0].confidence,
                confidenceBreakdown: release.classifications[0].confidenceBreakdown,
                requiresHumanReview: release.classifications[0].requiresHumanReview,
                createdAt: release.classifications[0].createdAt,
              }
            : null,
        },
        matches: matches.map((match) => ({
          id: match.id,
          repositoryId: match.repositoryId,
          repositoryName: match.repository.name,
          fullName: match.repository.fullName,
          matchReason: match.matchReason,
          status: match.status,
          createdAt: match.createdAt,
        })),
        evidence,
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
