import type { NextRequest } from "next/server";
import { getCorrelationId, jsonOk } from "@/lib/api";
import { listRegistryEntries } from "@patchbay/vendor-connectors";

/**
 * GET /api/registry
 * Public - lists certified migration recipes (DRAFT_PR + PLAN).
 * No auth required; serves the codemod registry for @patchbay/cli.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const entries = listRegistryEntries();
  return jsonOk({ recipes: entries, count: entries.length }, correlationId);
}
