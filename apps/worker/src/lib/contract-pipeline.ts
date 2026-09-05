import { prisma, storeRawEvidence } from "@patchbay/db";
import { logger } from "@patchbay/domain";
import {
  canonicalJson,
  normalizedChangeSchema,
  sha256Hex,
  type NormalizedChange,
} from "@patchbay/vendor-connectors";

/**
 * Contract ingestion pipeline (Production Spec §5, WP2).
 *
 * Owns persistence for the contract models; adapters (§5.2) never write
 * business tables. One call ingests one observed raw contract state:
 * hash → dedupe → store raw bytes → snapshot row → persist caller-computed
 * change records against the previous snapshot.
 *
 * Tenant boundary: ContractSource is MIXED visibility (public NULL-org rows
 * plus per-org feeds, like Vendor). Every call asserts the source is public
 * or owned by the caller org; ContractSnapshot/ContractChange carry no
 * organizationId and are reachable only through that join. RLS is
 * intentionally NOT enabled on these tables (it would hide the public
 * catalog, same rationale as Vendor) — explicit scoping here is the guard.
 *
 * Idempotency (three layers): identical bytes return the existing snapshot
 * row (content-addressed); change rows converge on the
 * (source, toSnapshot, identity) unique constraint with the receipt-style
 * unique-violation catch; re-ingest of the same observation is a no-op.
 */

export interface SnapshotIngestInput {
  sourceId: string;
  /** Caller org; must own the source unless the source is public (NULL org). */
  organizationId: string | null;
  rawText: string;
  normalizedJson: unknown;
  parserVersion: string;
  provenance?: Record<string, unknown>;
  /** Adapter-computed transitions vs the previous snapshot (WP4 wires adapters here). */
  changes?: NormalizedChange[];
}

export interface PersistedContractChange {
  /** Row id; null when a concurrent ingest won the race (converged, not created). */
  id: string | null;
  identity: string;
  created: boolean;
}

export interface SnapshotIngestResult {
  snapshotId: string;
  contentHash: string;
  normalizedHash: string;
  deduplicated: boolean;
  previousSnapshotId: string | null;
  changes: PersistedContractChange[];
}

async function loadScopedSource(sourceId: string, organizationId: string | null) {
  const source = await prisma.contractSource.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error(`contract source not found: ${sourceId}`);
  if (source.organizationId !== null && source.organizationId !== organizationId) {
    throw new Error(`contract source ${sourceId} belongs to another organization`);
  }
  return source;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

export async function ingestContractSnapshot(
  input: SnapshotIngestInput,
): Promise<SnapshotIngestResult> {
  if (!input.sourceId) throw new Error("ingestContractSnapshot requires sourceId");
  if (!input.rawText) throw new Error("ingestContractSnapshot requires rawText");
  if (!input.parserVersion) throw new Error("ingestContractSnapshot requires parserVersion");
  await loadScopedSource(input.sourceId, input.organizationId);

  const contentHash = sha256Hex(input.rawText);
  const normalizedHash = sha256Hex(canonicalJson(input.normalizedJson));

  const existing = await prisma.contractSnapshot.findUnique({
    where: { sourceId_contentHash: { sourceId: input.sourceId, contentHash } },
    select: { id: true },
  });
  if (existing) {
    return {
      snapshotId: existing.id,
      contentHash,
      normalizedHash,
      deduplicated: true,
      previousSnapshotId: null,
      changes: [],
    };
  }

  const previous = await prisma.contractSnapshot.findFirst({
    where: { sourceId: input.sourceId },
    orderBy: { observedAt: "desc" },
    select: { id: true, normalizedHash: true },
  });

  const stored = await storeRawEvidence(input.rawText);
  if (stored.contentHash !== contentHash) {
    throw new Error("evidence store hash mismatch; refusing to record snapshot");
  }

  const snapshot = await prisma.contractSnapshot.create({
    data: {
      sourceId: input.sourceId,
      contentHash,
      normalizedHash,
      rawArtifactUri: stored.key,
      normalizedJson: input.normalizedJson as never,
      parserVersion: input.parserVersion,
      provenanceJson: (input.provenance ?? null) as never,
    },
    select: { id: true },
  });

  const changes: PersistedContractChange[] = [];
  // Genesis observation (no predecessor) records the snapshot only: there is
  // no transition to persist, and WP4 orchestration decides first-sight cases.
  if (previous && previous.normalizedHash !== normalizedHash) {
    for (const raw of input.changes ?? []) {
      const change = normalizedChangeSchema.parse(raw);
      const persisted = await persistChange(input.sourceId, previous.id, snapshot.id, change);
      changes.push(persisted);
    }
  }

  logger.info("contract snapshot ingested", {
    sourceId: input.sourceId,
    snapshotId: snapshot.id,
    deduplicated: false,
    changeCount: changes.length,
  });
  return {
    snapshotId: snapshot.id,
    contentHash,
    normalizedHash,
    deduplicated: false,
    previousSnapshotId: previous?.id ?? null,
    changes,
  };
}

async function persistChange(
  sourceId: string,
  fromSnapshotId: string,
  toSnapshotId: string,
  change: NormalizedChange,
): Promise<PersistedContractChange> {
  const existing = await prisma.contractChange.findUnique({
    where: {
      sourceId_toSnapshotId_identity: { sourceId, toSnapshotId, identity: change.identity },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, identity: change.identity, created: false };
  try {
    const created = await prisma.contractChange.create({
      data: {
        sourceId,
        fromSnapshotId,
        toSnapshotId,
        changeType: change.changeType,
        severity: change.severity,
        identity: change.identity,
        description: change.description,
        evidenceJson: (change.evidenceJson ?? null) as never,
        migrationHintsJson: change.migrationHints as never,
      },
      select: { id: true },
    });
    return { id: created.id, identity: change.identity, created: true };
  } catch (error: unknown) {
    // Race: a concurrent ingest won the unique key first. Converge instead
    // of duplicating (same receipt-style catch as webhook delivery dedupe).
    if (isUniqueViolation(error)) return { id: null, identity: change.identity, created: false };
    throw error;
  }
}
