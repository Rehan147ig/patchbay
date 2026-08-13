import { prisma } from "@patchbay/db";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    await requireRole("VIEWER");

    const runs = await prisma.detectionRun.findMany({
      where: { adapter: { not: "" } },
      orderBy: { startedAt: "desc" },
      take: 50,
    });

    return jsonOk(
      {
        runs: runs.map((run) => ({
          id: run.id,
          adapter: run.adapter,
          status: run.status,
          observedCount: run.observedCount,
          error: run.error,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        })),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
