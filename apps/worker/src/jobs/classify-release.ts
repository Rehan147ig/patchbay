import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, logger } from "@patchbay/domain";
import { getConnector } from "@patchbay/vendor-connectors";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

/**
 * classify-release processor (Phase E: deterministic classification).
 *
 * Loads a ReleaseRecord, runs the matching vendor connector over a synthetic
 * release payload (sdk/fromVersion/toVersion + the connector's canonical
 * migration rules when the release crosses a known breaking landmark), and
 * persists facts deterministically: factsJson + confidence + human-review
 * flag. Always DETERMINISTIC — AI classification is a later, separate method.
 */
export const ClassifyReleaseJobDataSchema = z.object({
  releaseId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type ClassifyReleaseJobData = z.infer<typeof ClassifyReleaseJobDataSchema>;

/**
 * Known breaking landmarks per package. Keyed `package|toMajor`; entries carry
 * the connector migration payload that turns adapter knowledge into change
 * drafts. Only real, reviewable connector rules belong here.
 */
const KNOWN_MIGRATIONS: Record<
  string,
  { fromPattern: (from: string) => boolean; payload: unknown }
> = {
  "openai|4": {
    fromPattern: (from) => /^3\./.test(from),
    payload: {
      migration: {
        methodRenames: [
          {
            from: "openai.createChatCompletion",
            to: "openai.chat.completions.create",
          },
          {
            from: "openai.createCompletion",
            to: "openai.completions.create",
          },
          {
            from: "openai.createEmbedding",
            to: "openai.embeddings.create",
          },
        ],
        responseChanges: [
          {
            symbol: "completion.data",
            description:
              "Responses are no longer wrapped in .data in v4; describe the usage to read fields directly.",
          },
        ],
      },
    },
  },
};

export interface ClassifyReleaseResult {
  releaseId: string;
  method: "DETERMINISTIC";
  breaking: boolean;
  changeDraftCount: number;
  requiresHumanReview: boolean;
}

export async function processClassifyRelease(job: Job): Promise<ClassifyReleaseResult> {
  const parsed = ClassifyReleaseJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid classify-release job data: ${parsed.error.message}`);
  }
  const { releaseId, correlationId } = parsed.data;

  const release = await prisma.releaseRecord.findUnique({
    where: { id: releaseId },
    include: { product: { include: { vendor: true } } },
  });
  if (!release) {
    throw new Error(`release not found: ${releaseId}`);
  }

  const organizationId = release.product.vendor.organizationId ?? "org-acme";
  const vendorSlug = release.product.vendor.slug;
  const connector = getConnector(vendorSlug);
  const fromVersion = release.previousVersion ?? null;
  const toVersion = release.version;

  try {
    const toMajor = toVersion.split(".")[0];
    const landmark = KNOWN_MIGRATIONS[`${release.product.packageName}|${toMajor}`];
    const rulesMatched = landmark !== undefined && landmark.fromPattern(fromVersion ?? "");
    const adapterRules = rulesMatched ? landmark.payload : null;

    const rawPayload = {
      sdk: release.product.packageName,
      fromVersion: fromVersion ?? undefined,
      toVersion,
      ...(adapterRules ?? {}),
    };

    const drafts = connector
      ? connector.normalizeChange({ rawPayload, sourceType: "release-record" })
      : [];
    const breaking = Boolean(
      drafts.some((draft) => draft.breaking) ||
      (fromVersion !== null && majorBump(fromVersion, toVersion)),
    );

    const factsJson = {
      fromVersion,
      toVersion,
      breaking,
      adapter: connector?.slug ?? null,
      adapterMatched: connector !== null,
      rulesApplied: adapterRules ? Object.keys(adapterRules) : [],
      changeDrafts: drafts.map((draft) => ({
        changeType: draft.changeType,
        oldValue: draft.oldValue ?? null,
        newValue: draft.newValue ?? null,
        description: draft.description ?? null,
        breaking: draft.breaking,
        affectedSymbols: draft.affectedSymbols ?? [],
        rule: (draft.evidence as { rule?: string } | undefined)?.rule ?? null,
      })),
    };

    const classification = await prisma.releaseClassification.upsert({
      where: { releaseRecordId: releaseId },
      create: {
        releaseRecordId: releaseId,
        method: "DETERMINISTIC",
        factsJson,
        confidence: 95,
        confidenceBreakdown: {
          versionDelta: 100,
          breakingDetermination: adapterRules ? 100 : 60,
          adapterMatch: connector ? 100 : 0,
        },
        requiresHumanReview: breaking,
      },
      update: {
        method: "DETERMINISTIC",
        factsJson,
        confidence: 95,
        confidenceBreakdown: {
          versionDelta: 100,
          breakingDetermination: adapterRules ? 100 : 60,
          adapterMatch: connector ? 100 : 0,
        },
        requiresHumanReview: breaking,
      },
    });

    await prisma.releaseRecord.update({
      where: { id: releaseId },
      data: { status: "CLASSIFIED" },
    });

    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.RELEASE_CLASSIFIED,
      correlationId,
      entityType: "releaseRecord",
      entityId: releaseId,
      after: {
        version: toVersion,
        breaking,
        changeDraftCount: drafts.length,
        requiresHumanReview: breaking,
        adapter: connector?.slug ?? null,
        classificationId: classification.id,
      },
    });
    logger.info("release classified", {
      releaseId,
      correlationId,
      version: toVersion,
      breaking,
      changeDraftCount: drafts.length,
    });

    return {
      releaseId,
      method: "DETERMINISTIC",
      breaking,
      changeDraftCount: drafts.length,
      requiresHumanReview: breaking,
    };
  } catch (error) {
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.RELEASE_CLASSIFICATION_FAILED,
      correlationId,
      entityType: "releaseRecord",
      entityId: releaseId,
      after: { version: toVersion },
      metadata: { error: String(error) },
    });
    logger.error("release classification failed", {
      releaseId,
      correlationId,
      error: String(error),
    });
    throw error;
  }
}

function majorBump(from: string | null, to: string): boolean {
  const fromMajor = from?.split(".")[0] ?? "";
  const toMajor = to.split(".")[0] ?? "";
  if (!/^\d+$/.test(fromMajor) || !/^\d+$/.test(toMajor)) return false;
  return Number(toMajor) > Number(fromMajor);
}
