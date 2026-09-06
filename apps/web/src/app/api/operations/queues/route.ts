import { prisma } from "@patchbay/db";
import { dlqQueue, queue, readWorkerHeartbeats } from "@patchbay/queue";
import { getJobMirrorSnapshot, recordHttpDuration, withSpan } from "@patchbay/telemetry";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/operations/queues
 * Queue depth, DLQ counts, worker heartbeats, and job-transition mirror
 * (WP10, spec §10). ADMIN only: dead-letter payloads behind the counts are
 * sensitive, and fleet health is an operator surface.
 *
 * Degrades honestly: when Redis is unreachable the BullMQ counts come back
 * null with status "degraded" (the DB dead-letter count still answers),
 * never a 500 that hides the fleet state it is meant to expose.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const started = Date.now();
  try {
    const user = await requireRole("ADMIN");
    const result = await withSpan(
      "http.operations.queues",
      {
        "http.route": "/api/operations/queues",
        "http.method": "GET",
        "org.id": user.organizationId,
      },
      async () => {
        let counts: Record<string, number> | null = null;
        let dlqCounts: Record<string, number> | null = null;
        try {
          counts = (await queue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed",
            "delayed",
            "paused",
          )) as Record<string, number>;
          dlqCounts = (await dlqQueue.getJobCounts(
            "waiting",
            "active",
            "completed",
            "failed",
            "delayed",
            "paused",
          )) as Record<string, number>;
        } catch {
          counts = null;
          dlqCounts = null;
        }
        const [openDeadLetters, heartbeats] = await Promise.all([
          prisma.deadLetterJob.count({
            where: { organizationId: user.organizationId, status: "OPEN" },
          }),
          readWorkerHeartbeats(),
        ]);
        return {
          status: counts === null ? "degraded" : "ok",
          redis: counts === null ? "unreachable" : "reachable",
          queue: counts,
          dlqQueue: dlqCounts,
          openDeadLetters,
          workers: heartbeats,
          jobOutcomes: getJobMirrorSnapshot(),
        };
      },
    );
    recordHttpDuration("/api/operations/queues", "GET", Date.now() - started);
    return jsonOk(result, correlationId);
  } catch (error) {
    recordHttpDuration("/api/operations/queues", "GET", Date.now() - started);
    return jsonError(error, correlationId);
  }
}
