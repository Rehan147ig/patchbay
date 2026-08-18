import type { ReleaseSource } from "@patchbay/domain";

/**
 * Opaque, JSON-serializable position marker that an adapter persists between
 * poll cycles (ETag, last observed version, last published timestamp, spec
 * hash). Stored on DetectionRun.cursor so a poller restart never re-emits
 * evidence that was already observed. Adapters may narrow this type with a
 * local interface, keeping any JSON-serializable payload.
 */
export type AdapterCursor = Record<string, unknown>;

/**
 * Evidence payload from a Watchtower adapter.
 * The raw payload is stored as-is in ReleaseEvidence.objectStorageKey (content-addressed).
 * The adapter normalizes it into a structured form for ReleaseRecord creation.
 */
export interface WatchtowerEvidence {
  /** Unique identifier for this evidence within the adapter's namespace. */
  externalId: string;
  /** The vendor/product this evidence pertains to. */
  vendorSlug: string;
  packageName: string;
  /** The detected version. */
  version: string;
  /** Previous version if known (for changelog/diff). */
  previousVersion?: string;
  /** Source of this evidence. */
  source: ReleaseSource;
  /** URL to the canonical release page/changelog. */
  canonicalUrl?: string;
  /** Content hash of the raw evidence (for deduplication). */
  contentHash: string;
  /**
   * Raw payload captured from the source. Content-addressed and stored
   * verbatim in the evidence object store; contentHash is the SHA-256 of it.
   */
  rawPayload?: string;
  /** Published timestamp from the source. */
  publishedAt: Date;
  /** Any additional metadata (changelog excerpt, diff, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Normalized release data ready for ReleaseRecord creation.
 */
export interface NormalizedRelease {
  vendorSlug: string;
  packageName: string;
  version: string;
  previousVersion?: string;
  source: ReleaseSource;
  canonicalUrl?: string;
  contentHash: string;
  publishedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Result of one adapter poll: the evidence observed since the cursor plus the
 * cursor to persist for the next poll.
 */
export interface AdapterPollResult {
  evidence: WatchtowerEvidence[];
  cursor: AdapterCursor;
}

/**
 * Adapter for a specific evidence source (npm, GitHub releases, OpenAPI, etc.).
 * Adapters are pure functions - no DB, no network - for testability. fetch()
 * is the only network-touching operation and must be conditional (ETag /
 * If-None-Match or a persisted cursor) so polling is cheap and idempotent.
 */
export interface WatchtowerAdapter {
  /** Unique slug for this adapter (e.g., "npm", "github-releases", "openapi"). */
  slug: string;
  /** The source type this adapter produces. */
  source: ReleaseSource;
  /** Check if this adapter can handle the given raw input. */
  supports(input: unknown): boolean;
  /**
   * Normalize raw evidence into a structured release record.
   * Throws if the input cannot be normalized.
   */
  normalize(input: unknown): NormalizedRelease;
  /**
   * Fetch evidence newer than the persisted cursor (network call). The
   * returned cursor becomes the persisted DetectionRun.cursor for the next
   * poll. Returns empty evidence when nothing changed since the cursor.
   */
  fetch(cursor?: AdapterCursor): Promise<AdapterPollResult>;
}

/**
 * Result of a DetectionRun cycle.
 */
export interface DetectionRunResult {
  adapter: string;
  status: "COMPLETED" | "FAILED";
  observedCount: number;
  error?: string;
  cursor?: AdapterCursor;
}

export interface DetectOptions {
  /** Maximum number of evidence items to process per run. */
  batchSize?: number;
  /** Cursor for pagination/resumption. */
  cursor?: AdapterCursor;
}
