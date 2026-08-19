import { prisma } from "@patchbay/db";
import { notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { id } = await params;

    const repository = await prisma.repository.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        scans: { orderBy: { createdAt: "desc" }, take: 5 },
        graphIndexJobs: { orderBy: { startedAt: "desc" }, take: 5 },
        usages: {
          orderBy: [{ filePath: "asc" }, { createdAt: "asc" }],
          include: { vendor: true },
        },
        impactAssessments: {
          include: { changeEvent: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!repository) throw notFound("Repository not found");
    return jsonOk({ repository }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
