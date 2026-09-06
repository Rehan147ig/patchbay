import { prisma, storeRawEvidence } from "@patchbay/db";
import {
  assertMemoryLimitWithinCeiling,
  validationProfileSchema,
  type ValidationNetworkPolicy,
} from "@patchbay/domain";
import {
  assertAllowedImage,
  resolveValidationCommandIds,
  SANDBOX_MAX_RAW_OUTPUT_CHARS,
  type NetworkPolicy,
} from "@patchbay/sandbox-runner";
import { canonicalJson, sha256Hex } from "@patchbay/vendor-connectors";

/**
 * Validation execution-plane services (WP8, spec §19/§9).
 *
 * Profiles are the ONLY way to parameterize validation execution: command
 * ids resolve against the server-side registry (never raw strings),
 * images against the deployment allowlist, and timeouts/memory against
 * server ceilings. Every resolution failure throws — the caller fails the
 * run loudly, never with a weaker fallback.
 */

export interface ResolvedValidationProfile {
  profileId: string;
  profileName: string;
  profileVersion: number;
  commands: string[];
  image: string;
  /** Pinned digest or null (resolve-and-record when the profile pins none). */
  expectedDigest: string | null;
  timeoutMs: number;
  memoryLimit: string;
  networkPolicy: NetworkPolicy;
}

/** Load + fully validate a profile; cross-org and unknown ids fail closed. */
export async function resolveValidationProfile(
  profileId: string,
  organizationId: string,
): Promise<ResolvedValidationProfile> {
  // Org inside the query (not a post-hoc check): a foreign id reads as
  // missing, giving no cross-tenant oracle.
  const profile = await prisma.validationProfile.findFirst({
    where: { id: profileId, organizationId },
  });
  if (!profile) {
    throw new Error(`validation profile not found: ${profileId}`);
  }
  const parsed = validationProfileSchema.safeParse({
    name: profile.name,
    commandIds: profile.commandIds,
    image: profile.image,
    imageDigest: profile.imageDigest,
    timeoutMs: profile.timeoutMs,
    memoryLimit: profile.memoryLimit,
    networkPolicy: profile.networkPolicy,
  });
  if (!parsed.success) {
    throw new Error(`validation profile ${profileId} fails server policy: ${parsed.error.message}`);
  }
  const commands = resolveValidationCommandIds(parsed.data.commandIds);
  assertAllowedImage(parsed.data.image);
  assertMemoryLimitWithinCeiling(parsed.data.memoryLimit);
  return {
    profileId: profile.id,
    profileName: parsed.data.name,
    profileVersion: profile.version,
    commands,
    image: parsed.data.image,
    expectedDigest: parsed.data.imageDigest ?? null,
    timeoutMs: parsed.data.timeoutMs,
    memoryLimit: parsed.data.memoryLimit,
    networkPolicy: parsed.data.networkPolicy as ValidationNetworkPolicy as NetworkPolicy,
  };
}

export interface ValidationArtifactInput {
  validationRunId: string;
  organizationId: string;
  validationProfileId: string | null;
  commandsExecuted: string[];
  /** Per-command exit codes; null (killed/unavailable) is stored as -1. */
  exitCodes: Array<number | null>;
  image: string | null;
  imageDigest: string | null;
  fullStdout: string;
  fullStderr: string;
}

/**
 * Attest one terminal validation run. Full logs go to the content-addressed
 * evidence object store (never inline in the row); the row carries the URIs
 * plus a tamper-evident hash over the canonical descriptor. SKIPPED and
 * harness-error runs never reach here — there is nothing to attest.
 */
export async function recordValidationArtifact(input: ValidationArtifactInput): Promise<{
  artifactId: string;
  artifactHash: string;
}> {
  const exitCodes = input.exitCodes.map((code) => (typeof code === "number" ? code : -1));
  const commandSetHash = sha256Hex(canonicalJson({ commands: input.commandsExecuted }));
  const stdoutStored =
    input.fullStdout.length > 0 ? await storeRawEvidence(input.fullStdout) : null;
  const stderrStored =
    input.fullStderr.length > 0 ? await storeRawEvidence(input.fullStderr) : null;
  const stdoutComplete = input.fullStdout.length < SANDBOX_MAX_RAW_OUTPUT_CHARS;
  const stderrComplete = input.fullStderr.length < SANDBOX_MAX_RAW_OUTPUT_CHARS;
  const artifactHash = sha256Hex(
    canonicalJson({
      validationRunId: input.validationRunId,
      validationProfileId: input.validationProfileId,
      commandSetHash,
      commandsExecuted: input.commandsExecuted,
      exitCodes,
      image: input.image,
      imageDigest: input.imageDigest,
      stdoutUri: stdoutStored?.key ?? null,
      stderrUri: stderrStored?.key ?? null,
      stdoutComplete,
      stderrComplete,
    }),
  );
  const artifact = await prisma.validationArtifact.create({
    data: {
      organizationId: input.organizationId,
      validationRunId: input.validationRunId,
      validationProfileId: input.validationProfileId,
      commandSetHash,
      commandsExecuted: input.commandsExecuted,
      exitCodes,
      image: input.image,
      imageDigest: input.imageDigest,
      stdoutUri: stdoutStored?.key ?? null,
      stderrUri: stderrStored?.key ?? null,
      stdoutComplete,
      stderrComplete,
      artifactHash,
    },
  });
  return { artifactId: artifact.id, artifactHash };
}
