import { prisma } from "@patchbay/db";
import { connection, queue } from "@patchbay/queue";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonOk } from "@/lib/api";

/**
 * Platform health probe. Covers every hard dependency of request serving:
 * Postgres AND Redis AND queue readability. A DB-only check would report
 * "ok" while every enqueue fails, so Redis and the failed/waiting backlog
 * are part of the verdict — the orchestrator must stop routing traffic when
 * any of them is down.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  let redisOk = false;
  try {
    await connection.ping();
    redisOk = true;
  } catch {
    redisOk = false;
  }
  let backlog: { waiting: number; active: number; delayed: number; failed: number } | null = null;
  try {
    const counts: Record<string, number> = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
    );
    backlog = {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
    };
  } catch {
    backlog = null;
  }
  const ok = dbOk && redisOk;
  const body = {
    status: ok ? "ok" : "degraded",
    db: dbOk ? "ok" : "unreachable",
    redis: redisOk ? "ok" : "unreachable",
    queue: backlog,
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
  return jsonOk(body, correlationId, ok ? 200 : 503);
}
