import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCorrelationId, jsonError, jsonOk, parseBodyBounded, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

const MAX_PRIVATE_VENDOR_BODY_BYTES = 16 * 1024;

const privateVendorSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "slug must be lowercase alphanumeric with inner dashes"),
  name: z.string().min(1).max(100),
  category: z.string().min(1).max(50).default("Internal SDK"),
  docsUrl: z.string().url().max(500).optional(),
});

/**
 * POST /api/vendors/private
 *
 * Registers an ORGANIZATION-PRIVATE vendor (internal SDK) visible only inside
 * the caller's organization. Private vendors participate in scans, agent-key
 * issuance, and change ingestion exactly like catalog vendors, but other
 * tenants can never see or reference them. Slug must differ from the global
 * catalog and from every other private vendor (enforced by two partial unique
 * indexes: global-slug unique where org IS NULL; (org, slug) unique otherwise).
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const input = await parseBodyBounded(
      request,
      privateVendorSchema,
      MAX_PRIVATE_VENDOR_BODY_BYTES,
    );

    // Ownership check against BOTH uniqueness spaces: the public catalog and
    // this org's private set.
    const [publicClash, privateClash] = await Promise.all([
      prisma.vendor.findFirst({
        where: { slug: input.slug, organizationId: null },
        select: { id: true },
      }),
      prisma.vendor.findFirst({
        where: {
          organizationId: user.organizationId,
          slug: input.slug,
        },
        select: { id: true },
      }),
    ]);
    if (publicClash || privateClash) {
      throw validationFailed(`Vendor slug "${input.slug}" is already registered`);
    }

    const vendor = await prisma.vendor.create({
      data: {
        organizationId: user.organizationId,
        slug: input.slug,
        name: input.name,
        category: input.category,
        docsUrl: input.docsUrl ?? null,
        enabled: true,
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.VENDOR_TOGGLED,
      entityType: "vendor",
      entityId: vendor.id,
      correlationId,
      after: {
        vendorSlug: input.slug,
        visibility: "PRIVATE",
        category: input.category,
      },
    });

    return jsonOk(
      {
        vendorSlug: input.slug,
        vendorId: vendor.id,
        visibility: "PRIVATE",
      },
      correlationId,
      201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
