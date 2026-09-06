import { prisma, encryptSecret, isKmsConfigured, type Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, ContractKind, validationFailed } from "@patchbay/domain";
import { z } from "zod";
import type { NextRequest } from "next/server";
import {
  getCorrelationId,
  jsonError,
  jsonOk,
  parseBody,
  parseQuery,
  writeAuditEvent,
} from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { listContractSources } from "@/lib/contract-sources";

/**
 * GET /api/contracts/sources
 * Contract sources visible to the caller's org (WP12 §11.2): public catalog
 * rows (NULL org) plus the org's own registrations — the same MIXED rule the
 * Vendor catalog uses, enforced explicitly here (never blanket-scoped).
 * Each row carries snapshot/change counts and a derived health signal so the
 * Sources page renders without N+1 queries. VIEWER and above.
 */
const sourcesQuerySchema = z.object({
  kind: z.string().min(1).max(30).optional(),
  vendorSlug: z.string().min(1).max(100).optional(),
});

const CONTRACT_KINDS = Object.values(ContractKind);

export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const query = parseQuery(request, sourcesQuerySchema);
    if (query.kind !== undefined && !(CONTRACT_KINDS as string[]).includes(query.kind)) {
      throw validationFailed(`Unknown contract kind: ${query.kind}`);
    }
    const sources = await listContractSources(user.organizationId, {
      kind: query.kind,
      vendorSlug: query.vendorSlug,
    });
    return jsonOk({ sources }, correlationId);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

const contractSourceCreateSchema = z.object({
  vendorSlug: z.string().min(1).max(100),
  kind: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  /** Optional provider config (e.g. feed credentials); sealed when KMS is configured. */
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/contracts/sources
 * Registers an organization-private contract source (WP12 §11.2). ADMIN only.
 * The (org, vendor, kind, name) lookup makes re-registration idempotent:
 * duplicates return the existing row, never a 500.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("ADMIN");
    const input = await parseBody(request, contractSourceCreateSchema);
    if (!(CONTRACT_KINDS as string[]).includes(input.kind)) {
      throw validationFailed(`Unknown contract kind: ${input.kind}`);
    }
    const vendor = await prisma.vendor.findFirst({
      where: {
        slug: input.vendorSlug,
        OR: [{ organizationId: null }, { organizationId: user.organizationId }],
      },
      select: { slug: true },
    });
    if (!vendor) {
      throw validationFailed(`Unknown vendor: ${input.vendorSlug}`);
    }
    let configEncrypted: string | null = null;
    if (input.config !== undefined) {
      // Sealed configs must actually seal: without a real KMS key the stub
      // would encrypt with a zero key (theater, not security) — refuse first.
      if (!isKmsConfigured()) {
        throw validationFailed(
          "Source config requires KMS_KEY to be configured; refusing to store provider credentials unsealed",
        );
      }
      configEncrypted = encryptSecret(JSON.stringify(input.config));
    }

    const existing = await prisma.contractSource.findFirst({
      where: {
        organizationId: user.organizationId,
        vendorSlug: input.vendorSlug,
        kind: input.kind,
        name: input.name,
      },
    });
    if (existing) {
      return jsonOk({ source: existing, duplicate: true }, correlationId);
    }
    const source = await prisma.contractSource.create({
      data: {
        organizationId: user.organizationId,
        vendorSlug: input.vendorSlug,
        kind: input.kind,
        name: input.name,
        configEncrypted,
        status: "ACTIVE",
      } as Prisma.ContractSourceCreateInput,
    });
    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.CONTRACT_SOURCE_CREATED,
      entityType: "contractSource",
      entityId: source.id,
      correlationId,
      after: { vendorSlug: source.vendorSlug, kind: source.kind, name: source.name },
    });
    return jsonOk({ source, duplicate: false }, correlationId, 201);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
