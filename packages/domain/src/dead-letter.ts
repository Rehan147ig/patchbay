import { z } from "zod";

/**
 * Dead-letter vocabulary (WP10, spec §10). Stored as plain strings on
 * DeadLetterJob (no Prisma enum to drift); writes go through this schema.
 */

export const deadLetterStatusSchema = z.enum(["OPEN", "REPLAYED"]);
export type DeadLetterStatus = z.infer<typeof deadLetterStatusSchema>;

/** Replayable job types: a closed allowlist, never arbitrary re-enqueue. */
export const replayableJobTypeSchema = z.enum([
  "scan-repository",
  "run-validation",
  "create-pr",
  "graph-index",
]);
export type ReplayableJobType = z.infer<typeof replayableJobTypeSchema>;
