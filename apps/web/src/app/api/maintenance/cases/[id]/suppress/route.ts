import type { NextRequest } from "next/server";
import { POST as cancelCase } from "../../../../cases/[id]/cancel/route";

/**
 * POST /api/maintenance/cases/[id]/suppress
 * Suppresses a case: terminates it as CANCELLED (owner decision, stays
 * visible with its terminal outcome; only a replay reopens it). The cancel
 * vector is the single implementation — suppression and cancellation are
 * the same terminal state reached from different UI intents.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return cancelCase(request, { params });
}
