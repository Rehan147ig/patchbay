import { prisma } from "@patchbay/db";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonOk } from "@/lib/api";

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = {
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "ok" : "unreachable",
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
  return jsonOk(body, correlationId, dbOk ? 200 : 503);
}
