import type { NextRequest } from "next/server";
import { CAPABILITY_VOCABULARY } from "@patchbay/domain";
import { getCorrelationId, jsonOk } from "@/lib/api";

/**
 * GET /api/capability-matrix
 * Public - serves the WP1 capability vocabulary (Production Spec §2.2): the
 * seven connector dimensions, contract kinds, and certification states.
 * No auth required; the CLI, dashboard filters, and policy tooling share
 * these exact strings instead of hardcoding their own copies.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  return jsonOk({ vocabulary: CAPABILITY_VOCABULARY }, correlationId);
}
