import "server-only";
import { prisma } from "@patchbay/db";

/**
 * Shared contract-source shaping (WP12): the sources API route and the
 * Sources page read through this so health semantics never drift between
 * the JSON contract and the rendered view.
 */

export interface ShapedContractSource {
  id: string;
  vendorSlug: string;
  kind: string;
  name: string;
  scope: "catalog" | "organization";
  status: string;
  lastObservedAt: Date | null;
  counts: { snapshots: number; changes: number; consumers: number };
  health: "healthy" | "stale";
}

const STALE_AFTER_MS = 7 * 86_400_000;

export function shapeContractSource(
  source: Omit<ShapedContractSource, "scope" | "health"> & { organizationId: string | null },
  now: number = Date.now(),
): ShapedContractSource {
  const { organizationId, ...rest } = source;
  return {
    ...rest,
    scope: organizationId === null ? "catalog" : "organization",
    health:
      source.status === "ACTIVE" &&
      source.lastObservedAt !== null &&
      now - new Date(source.lastObservedAt).getTime() < STALE_AFTER_MS
        ? "healthy"
        : "stale",
  };
}

export async function listContractSources(
  organizationId: string,
  filters: { kind?: string; vendorSlug?: string } = {},
  now: number = Date.now(),
): Promise<ShapedContractSource[]> {
  const sources = await prisma.contractSource.findMany({
    where: {
      OR: [{ organizationId: null }, { organizationId }],
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.vendorSlug ? { vendorSlug: filters.vendorSlug } : {}),
    },
    orderBy: [{ vendorSlug: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { snapshots: true, changes: true, consumers: true } },
    },
  });
  return sources.map((source) =>
    shapeContractSource(
      {
        id: source.id,
        vendorSlug: source.vendorSlug,
        kind: source.kind,
        name: source.name,
        organizationId: source.organizationId,
        status: source.status,
        lastObservedAt: source.lastObservedAt,
        counts: source._count,
      },
      now,
    ),
  );
}
