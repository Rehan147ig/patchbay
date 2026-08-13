import { prisma } from "@patchbay/db";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/runs — recent agent runs for the organization (list view).
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");

    const runs = await prisma.agentRun.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        releaseRecord: { select: { version: true, product: { select: { packageName: true } } } },
        repository: { select: { name: true, fullName: true } },
        match: { select: { id: true } },
      },
    });

    return jsonOk(
      {
        runs: runs.map((run) => ({
          id: run.id,
          status: run.status,
          type: run.type,
          packageName: run.releaseRecord.product.packageName,
          version: run.releaseRecord.version,
          repositoryName: run.repository.name,
          fullName: run.repository.fullName,
          reviewStatus: reviewStatusOf(run.outputJson),
          costEstimateCents: run.costEstimateCents,
          error: run.error,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
        })),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

function reviewStatusOf(outputJson: unknown): "approved" | "rejected" | "pending" {
  if (typeof outputJson !== "object" || outputJson === null) return "pending";
  const review = (outputJson as { review?: { approved?: unknown } }).review;
  if (typeof review?.approved === "boolean") return review.approved ? "approved" : "rejected";
  return "pending";
}
