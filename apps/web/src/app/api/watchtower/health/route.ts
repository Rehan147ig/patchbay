import { prisma } from "@patchbay/db";
import { getWatchtowerAdapters, trustProfileFor } from "@patchbay/vendor-connectors";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

const HEALTH_WINDOW = 20;

/**
 * Detector health view (WP6): per-adapter last success, latency, cursor
 * presence, rejection/error rate, observed counts, trust profile, and the
 * global release backlog + evidence authenticity distribution.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    await requireRole("VIEWER");

    const adapters = getWatchtowerAdapters();

    const detectorHealth = await Promise.all(
      adapters.map(async (adapter) => {
        const lastRun = await prisma.detectionRun.findFirst({
          where: { adapter: adapter.slug },
          orderBy: { startedAt: "desc" },
        });

        const recent = await prisma.detectionRun.findMany({
          where: { adapter: adapter.slug },
          orderBy: { startedAt: "desc" },
          take: HEALTH_WINDOW,
          select: {
            status: true,
            latencyMs: true,
            observedCount: true,
            rejectionReason: true,
          },
        });

        const failed = recent.filter((r) => r.status === "FAILED").length;
        const errorRate = recent.length > 0 ? failed / recent.length : 0;
        const latencies = recent.map((r) => r.latencyMs).filter((l): l is number => l !== null);
        const avgLatencyMs =
          latencies.length > 0
            ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
            : null;
        const observedTotal = recent.reduce((a, r) => a + r.observedCount, 0);
        const lastRejection =
          recent.find((r) => r.rejectionReason !== null)?.rejectionReason ?? null;

        const profile = trustProfileFor(adapter.slug);

        return {
          slug: adapter.slug,
          source: adapter.source,
          profile: {
            allowedDomains: profile.allowedDomains,
            allowRedirects: profile.allowRedirects,
            maxResponseBytes: profile.maxResponseBytes,
            timeoutMs: profile.timeoutMs,
            requireSignature: profile.requireSignature,
            evidenceAuthenticity: profile.evidenceAuthenticity,
            evidenceConfidence: profile.evidenceConfidence,
            cadenceMs: profile.cadenceMs,
          },
          lastRun: lastRun
            ? {
                id: lastRun.id,
                status: lastRun.status,
                startedAt: lastRun.startedAt,
                completedAt: lastRun.completedAt,
                latencyMs: lastRun.latencyMs,
                observedCount: lastRun.observedCount,
                error: lastRun.error,
                rejectionReason: lastRun.rejectionReason,
                cursorPresent: lastRun.cursor !== null,
              }
            : null,
          window: {
            runs: recent.length,
            failed,
            errorRate: Number(errorRate.toFixed(3)),
            avgLatencyMs,
            observedTotal,
          },
          lastRejection,
        };
      }),
    );

    const [backlog, authenticity] = await Promise.all([
      prisma.releaseRecord.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.releaseRecord.groupBy({
        by: ["authenticity"],
        _count: { _all: true },
      }),
    ]);

    return jsonOk(
      {
        adapters: detectorHealth,
        global: {
          backlog: Object.fromEntries(backlog.map((b) => [b.status, b._count._all])),
          authenticity: Object.fromEntries(
            authenticity.map((a) => [a.authenticity, a._count._all]),
          ),
        },
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
