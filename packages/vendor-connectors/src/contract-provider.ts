import { z } from "zod";
import type { ContractKind } from "@patchbay/domain";

/**
 * Contract provider adapter interface (Production Spec §5.2, WP2).
 *
 * Adapters are the ONLY code that speaks provider protocols (registries,
 * release feeds, spec documents, and event docs). They return
 * normalized data; the ingestion service (worker contract pipeline) owns
 * persistence, deduplication, and case creation. Adapters must never write
 * directly to business tables, hold credentials, or touch the database.
 *
 * This generalizes the WatchtowerAdapter (release-evidence polling) to every
 * contract family: snapshot acquisition, normalization, diffing, and
 * migration hints behind one contract.
 */

export const inboundEventSchema = z.object({
  headers: z.record(z.string(), z.string()),
  rawBody: z.string().max(5_000_000),
  sourceSlug: z.string().min(1).max(200),
});
export type InboundEvent = z.infer<typeof inboundEventSchema>;

export interface VerifiedEvent {
  sourceSlug: string;
  /** Stable provider event id for receipt deduplication. */
  eventId: string;
  eventType: string;
  payload: unknown;
}

export const rawContractSnapshotSchema = z.object({
  /** SHA-256 of the raw contract bytes (canonical identity). */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  rawText: z.string().min(1).max(10_000_000),
  observedAt: z.string().datetime(),
  provenanceJson: z.record(z.string(), z.unknown()).optional(),
});
export type RawContractSnapshot = z.infer<typeof rawContractSnapshotSchema>;

export const normalizedContractSnapshotSchema = z.object({
  /** SHA-256 of the canonical normalized form (change detection). */
  normalizedHash: z.string().regex(/^[0-9a-f]{64}$/),
  normalizedJson: z.unknown(),
  parserVersion: z.string().min(1).max(100),
});
export type NormalizedContractSnapshot = z.infer<typeof normalizedContractSnapshotSchema>;

export const migrationHintSchema = z.object({
  kind: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).optional(),
});
export type MigrationHint = z.infer<typeof migrationHintSchema>;

export const normalizedChangeSchema = z.object({
  /** Adapter-normalized change identity, stable across re-polls. */
  identity: z.string().min(1).max(500),
  changeType: z.string().min(1).max(100),
  severity: z.string().min(1).max(50),
  description: z.string().min(1).max(4000),
  evidenceJson: z.unknown().optional(),
  migrationHints: z.array(migrationHintSchema).default([]),
});
export type NormalizedChange = z.infer<typeof normalizedChangeSchema>;

export interface ContractSourceRef {
  id: string;
  vendorSlug: string;
  kind: ContractKind;
  /** Already-parsed provider config (decrypted by the caller); adapters never touch secrets. */
  config?: unknown;
}

export interface ContractProviderAdapter {
  readonly slug: string;
  readonly contractKinds: readonly ContractKind[];
  /** Authenticate + parse an inbound provider event (webhook). Throws on rejection. */
  verifyInboundEvent(input: InboundEvent): Promise<VerifiedEvent>;
  /** Fetch the current raw contract state from the provider (network call). */
  fetchCurrentSnapshot(source: ContractSourceRef): Promise<RawContractSnapshot>;
  /** Normalize raw state into the canonical form (pure, no network). */
  normalize(snapshot: RawContractSnapshot): Promise<NormalizedContractSnapshot>;
  /** Diff two normalized snapshots; null previous means genesis (no changes). */
  diff(
    previous: NormalizedContractSnapshot | null,
    current: NormalizedContractSnapshot,
  ): Promise<NormalizedChange[]>;
  /** Migration guidance for one normalized change (pure). */
  getMigrationHints(change: NormalizedChange): Promise<MigrationHint[]>;
}
