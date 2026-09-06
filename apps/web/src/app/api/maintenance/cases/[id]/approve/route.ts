import type { NextRequest } from "next/server";
import { POST as approveCase } from "../../../../cases/[id]/approve/route";

/**
 * POST /api/maintenance/cases/[id]/approve
 * Canonical maintenance alias for the case approval vector: records an
 * explicit owner approval on the case's latest plan. Single implementation
 * lives in /api/cases/[id]/approve — this namespace delegates so both
 * surfaces enforce identical gates.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return approveCase(request, { params });
}
