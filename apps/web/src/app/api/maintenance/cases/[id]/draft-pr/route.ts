import type { NextRequest } from "next/server";
import { POST as draftPrForCase } from "../../../../cases/[id]/draft-pr/route";

/**
 * POST /api/maintenance/cases/[id]/draft-pr
 * Canonical maintenance alias for the case draft-PR vector (certification,
 * capability gate, policy, quorum, autonomy tier — all re-evaluated inside).
 * Single implementation lives in /api/cases/[id]/draft-pr.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return draftPrForCase(request, { params });
}
