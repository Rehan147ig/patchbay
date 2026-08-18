import { prisma } from "@patchbay/db";
import { notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/cases/[id]
 * One remediation case with its timeline, agent runs, plans and PRs.
 * Tenant-scoped: a case owned by another organization is a 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const remediationCase = await prisma.remediationCase.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        events: { orderBy: { createdAt: "desc" } },
        agentRuns: { orderBy: { createdAt: "desc" } },
        plans: {
          include: {
            patches: true,
            validations: { orderBy: { createdAt: "desc" } },
            approvals: true,
            pullRequests: true,
          },
          orderBy: { createdAt: "desc" },
        },
        release: {
          select: {
            id: true,
            version: true,
            publishedAt: true,
            product: {
              select: { packageName: true, vendor: { select: { slug: true, name: true } } },
            },
          },
        },
        repository: { select: { id: true, fullName: true, name: true } },
        dependency: {
          select: { id: true, packageName: true, resolvedVersion: true, commitSha: true },
        },
        snapshot: {
          select: { id: true, commitSha: true, nodesAffected: true, edgesAffected: true },
        },
      },
    });
    if (!remediationCase) {
      throw notFound("Remediation case not found");
    }

    return jsonOk({ remediationCase }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
