import { prisma } from "@patchbay/db";
import { notFound } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { id } = await params;

    const event = await prisma.vendorChangeEvent.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        vendor: true,
        normalizations: true,
        impactAssessments: {
          include: { repository: true, plans: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!event) throw notFound("Change event not found");
    return jsonOk({ event }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
