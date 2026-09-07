import type { NextRequest } from "next/server";
import { getCorrelationId, jsonOk } from "@/lib/api";

/**
 * Liveness probe. This endpoint intentionally does not touch Postgres, Redis,
 * or BullMQ so a dependency outage does not cause a healthy process to be
 * restarted. Use /api/health for readiness.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  return jsonOk(
    {
      status: "ok",
      service: "web",
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    correlationId,
  );
}