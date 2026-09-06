import { z } from "zod";

/**
 * Validation execution-plane vocabulary (WP8, spec §19/§9). DB-free: Prisma
 * mirrors nothing here (network policy is a plain string column validated by
 * this schema at every write/resolve boundary).
 */

export const validationNetworkPolicySchema = z.enum(["none", "registry-only"]);
export type ValidationNetworkPolicy = z.infer<typeof validationNetworkPolicySchema>;

/** Server-side ceiling for profile-pinned per-command timeouts (10 minutes). */
export const VALIDATION_PROFILE_MAX_TIMEOUT_MS = 600_000;
/** Server-side ceiling for profile-pinned container memory (4 GiB). */
export const VALIDATION_PROFILE_MAX_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;

/** Docker-style memory limit: integer + k/m/g suffix (e.g. "512m", "2g"). */
export const memoryLimitSchema = z
  .string()
  .min(2)
  .max(12)
  .regex(/^\d+[kKmMgG]$/, 'memory limit must look like "512m" or "2g"');

export const validationProfileSchema = z.object({
  name: z.string().min(1).max(100),
  /** Fixed allowlist identifiers — never raw command strings. */
  commandIds: z.array(z.string().min(1).max(80)).min(1).max(16),
  /** Container image reference; must be on the deployment image allowlist. */
  image: z.string().min(1).max(300),
  /** Pinned OCI digest; null = resolve-and-record (explicit pinning is opt-in). */
  imageDigest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/, "image digest must be sha256:<64 hex chars>")
    .nullable()
    .optional(),
  timeoutMs: z.number().int().min(1_000).max(VALIDATION_PROFILE_MAX_TIMEOUT_MS),
  memoryLimit: memoryLimitSchema,
  networkPolicy: validationNetworkPolicySchema,
});
export type ValidationProfileInput = z.infer<typeof validationProfileSchema>;

/** Parse a validated memory limit ("512m") to bytes for ceiling enforcement. */
export function parseMemoryLimitToBytes(memoryLimit: string): number {
  const parsed = memoryLimitSchema.safeParse(memoryLimit);
  if (!parsed.success) {
    throw new Error(`invalid memory limit: ${memoryLimit}`);
  }
  const value = Number.parseInt(parsed.data.slice(0, -1), 10);
  const unit = parsed.data.slice(-1).toLowerCase();
  const multiplier = unit === "k" ? 1024 : unit === "m" ? 1024 * 1024 : 1024 * 1024 * 1024;
  return value * multiplier;
}

/** Fail closed when a profile asks for more memory than the server allows. */
export function assertMemoryLimitWithinCeiling(memoryLimit: string): void {
  const bytes = parseMemoryLimitToBytes(memoryLimit);
  if (bytes > VALIDATION_PROFILE_MAX_MEMORY_BYTES) {
    throw new Error(
      `memory limit ${memoryLimit} exceeds the server ceiling of 4g; refusing profile`,
    );
  }
}
