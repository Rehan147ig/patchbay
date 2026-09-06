import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, autonomyTierSchema, DEFAULT_AUTONOMY_TIER } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { z } from "zod";

const autonomyTierRequestSchema = z.object({ tier: autonomyTierSchema });

/**
 * GET /api/settings/autonomy-tier
 * Reads the organization's default delivery autonomy tier (WP12). MEMBER and
 * above. Lazily creates the AutonomyPolicy row (with the recommended tier)
 * on first read so every org has an explicit tier from day one — the same
 * lazy pattern as /api/settings/autonomy.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const policy = await prisma.autonomyPolicy.upsert({
      where: { organizationId: user.organizationId },
      update: {},
      create: { organizationId: user.organizationId, defaultDecision: DEFAULT_AUTONOMY_TIER },
    });
    const parsed = autonomyTierSchema.safeParse(policy.defaultDecision);
    return jsonOk(
      { tier: parsed.success ? parsed.data : DEFAULT_AUTONOMY_TIER, explicit: parsed.success },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

/**
 * PUT /api/settings/autonomy-tier
 * Sets the tier. ADMIN only; audited. Takes effect on the next PR delivery:
 * PLAN_ONLY refuses everywhere, REQUIRE_APPROVAL needs a covering approval,
 * ALLOW_DRAFT_PR keeps existing gate behavior.
 */
export async function PUT(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const input = await parseBody(request, autonomyTierRequestSchema);
    const before = await prisma.autonomyPolicy.findUnique({
      where: { organizationId: user.organizationId },
      select: { defaultDecision: true },
    });
    const policy = await prisma.autonomyPolicy.upsert({
      where: { organizationId: user.organizationId },
      update: { defaultDecision: input.tier },
      create: { organizationId: user.organizationId, defaultDecision: input.tier },
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.AUTONOMY_TIER_CHANGED,
      entityType: "autonomyPolicy",
      entityId: policy.id,
      correlationId,
      before: { tier: before?.defaultDecision ?? null },
      after: { tier: input.tier },
    });
    return jsonOk({ tier: input.tier }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
