import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, validationFailed } from "@patchbay/domain";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

const AutonomyPolicySchema = z.object({
  maxOpenAutonomousPRs: z.number().int().min(0).max(50),
  minimumReleaseAgeDays: z.number().int().min(0).max(30),
  groupMinorPatches: z.boolean(),
  vulnBypassStability: z.boolean(),
  excludedPackages: z
    .array(
      z
        .string()
        .min(1)
        .max(214)
        .regex(/^[a-z0-9@/_+.-]+$/i),
    )
    .max(200),
});

/**
 * GET /api/settings/autonomy
 *
 * Reads the organization's autonomous-track guardrails. MEMBER and above.
 * Lazily creates the row with safe defaults on first read so every org has
 * explicit policy from day one without a seed/backfill.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("MEMBER");
    const policy = await prisma.autonomyPolicy.upsert({
      where: { organizationId: user.organizationId },
      update: {},
      create: { organizationId: user.organizationId },
    });
    return jsonOk(
      {
        maxOpenAutonomousPRs: policy.maxOpenAutonomousPRs,
        minimumReleaseAgeDays: policy.minimumReleaseAgeDays,
        groupMinorPatches: policy.groupMinorPatches,
        vulnBypassStability: policy.vulnBypassStability,
        excludedPackages: policy.excludedPackages,
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

/**
 * PUT /api/settings/autonomy
 *
 * Updates the guardrails. ADMIN only; every change is audit-logged.
 * Ranges are clamped by schema: caps 0-50, age 0-30d, 200 exclusions max.
 */
export async function PUT(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const parsed = AutonomyPolicySchema.safeParse(await request.json());
    if (!parsed.success) {
      throw validationFailed(`Invalid autonomy policy: ${parsed.error.message}`);
    }
    const policy = await prisma.autonomyPolicy.upsert({
      where: { organizationId: user.organizationId },
      update: parsed.data,
      create: { organizationId: user.organizationId, ...parsed.data },
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.AUTONOMY_POLICY_UPDATED,
      entityType: "organization",
      entityId: user.organizationId,
      correlationId,
      after: { ...parsed.data },
    });
    return jsonOk(
      {
        maxOpenAutonomousPRs: policy.maxOpenAutonomousPRs,
        minimumReleaseAgeDays: policy.minimumReleaseAgeDays,
        groupMinorPatches: policy.groupMinorPatches,
        vulnBypassStability: policy.vulnBypassStability,
        excludedPackages: policy.excludedPackages,
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
