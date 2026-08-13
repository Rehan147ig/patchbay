import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import {
  ActorType,
  ImpactStatus,
  PlanStatus,
  validationFailed,
  type ChangeType,
} from "@patchbay/domain";
import { getConnector, type NormalizedChangeDraft } from "@patchbay/vendor-connectors";
import { generatePlan, scanPatches } from "@patchbay/remediation-engine";
import { createAiProvider, type AiPlanDraftInput } from "@patchbay/ai-provider";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/vendor-changes/[id]/plan
 * Runs the deterministic remediation rule engine synchronously for every
 * affected impact assessment of the event (scoped to the caller's org) and
 * persists a RemediationPlan with its PatchArtifacts.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;

    const event = await prisma.vendorChangeEvent.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        vendor: true,
        normalizations: true,
        impactAssessments: {
          include: {
            repository: true,
            affectedUsages: { include: { usage: true } },
          },
        },
      },
    });
    if (!event) throw validationFailed("Change event not found");

    const assessments = event.impactAssessments.filter(
      (assessment) =>
        assessment.repository.organizationId === user.organizationId &&
        (assessment.status === ImpactStatus.AFFECTED ||
          assessment.status === ImpactStatus.POSSIBLY_AFFECTED),
    );

    const drafts = event.normalizations.map((row) => draftFromRow(row));
    const connector = getConnector(event.vendor.slug);
    const patchSuggestions = connector ? connector.buildPatchSuggestions(drafts) : [];

    // Advisory AI note (Zod-validated, redacted context). Only when a real
    // provider is configured; the default mock provider stays out of the plan
    // path so deterministic output and the E2E flow are unchanged.
    const aiProvider =
      process.env.AI_PROVIDER === "openai" || process.env.AI_PROVIDER === "openai-compatible"
        ? createAiProvider(process.env)
        : null;

    const plans: Array<{
      id: string;
      impactAssessmentId: string;
      repositoryName: string;
      patchCount: number;
      confidence: number;
      requiresHumanReview: boolean;
    }> = [];

    for (const assessment of assessments) {
      const fixture = fixtureOf(assessment.repository.metadata);
      if (!fixture) continue;

      const usages = assessment.affectedUsages.map(({ usage }) => ({
        filePath: usage.filePath,
        line: usageLine(usage),
        symbol: usage.symbol,
        excerpt: usageExcerpt(usage),
      }));

      const result = generatePlan({
        fixtureDir: resolveFixtureDir(fixture),
        repositoryName: assessment.repository.name,
        usages,
        patchSuggestions,
        normalizations: drafts,
        assessmentConfidence: assessment.confidence,
      });

      // Patches are generated from repository content that may be hostile.
      // Never persist a patch whose patched content contains execution,
      // shell, escape or credential constructs; record why it was skipped.
      const safetyVerdict = scanPatches(result.patches);
      const safePatches = result.patches.filter(
        (patch) => !safetyVerdict.findings.some((finding) => finding.filePath === patch.filePath),
      );

      const aiNote = await draftAiNote(aiProvider, drafts, usages);

      const planId = crypto.randomUUID();
      await prisma.$transaction([
        prisma.remediationPlan.create({
          data: {
            id: planId,
            organizationId: user.organizationId,
            impactAssessmentId: assessment.id,
            status: PlanStatus.DRAFT,
            strategy: result.strategy,
            proposedChanges: result.proposedChanges as never,
            confidence: result.confidence,
            requiresHumanReview: result.requiresHumanReview,
          },
        }),
        ...safePatches.map((patch) =>
          prisma.patchArtifact.create({
            data: {
              remediationPlanId: planId,
              organizationId: user.organizationId,
              filePath: patch.filePath,
              unifiedDiff: patch.unifiedDiff,
              originalContent: patch.original,
              patchedContent: patch.patched,
              originalHash: patch.originalHash,
              patchedHash: patch.patchedHash,
              generationMethod: patch.generationMethod,
              confidence: patch.confidence,
            },
          }),
        ),
      ]);

      plans.push({
        id: planId,
        impactAssessmentId: assessment.id,
        repositoryName: assessment.repository.name,
        patchCount: safePatches.length,
        confidence: result.confidence,
        requiresHumanReview: result.requiresHumanReview,
      });

      await writeAuditEvent({
        organizationId: user.organizationId,
        actorType: ActorType.USER,
        actorId: user.id,
        action: AuditAction.PLAN_CREATED,
        entityType: "remediationPlan",
        entityId: planId,
        correlationId,
        after: {
          changeEventId: event.id,
          vendorSlug: event.vendor.slug,
          repositoryName: assessment.repository.name,
          patchCount: safePatches.length,
          skippedFiles: result.skippedFiles,
          unsafePatchesSkipped: safetyVerdict.findings,
          confidence: result.confidence,
          requiresHumanReview: result.requiresHumanReview,
          aiNote,
        },
      });
    }

    if (plans.length === 0) {
      throw validationFailed("No affected repositories found for this change in your organization");
    }

    return jsonOk({ changeEventId: event.id, plans }, correlationId, 201);
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

async function draftAiNote(
  provider: ReturnType<typeof createAiProvider> | null,
  drafts: NormalizedChangeDraft[],
  usages: Array<{ filePath: string; symbol: string; excerpt: string }>,
): Promise<{ rationale: string; confidence: number } | null> {
  if (!provider || drafts.length === 0) return null;
  const draft = drafts[0]!;
  try {
    const input: AiPlanDraftInput = {
      vendorSlug: "openai",
      changeType: draft.changeType,
      oldValue: draft.oldValue,
      newValue: draft.newValue,
      description: draft.description,
      affectedSymbols: draft.affectedSymbols,
      usages: usages.slice(0, 10).map((usage) => ({
        filePath: usage.filePath,
        excerpt: usage.excerpt.slice(0, 500),
      })),
    };
    const result = await provider.draftRemediationPlan(input);
    return { rationale: result.rationale, confidence: result.confidence };
  } catch {
    // AI is advisory: a provider failure must never block plan creation.
    return null;
  }
}

function draftFromRow(row: {
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  description: string | null;
  breaking: boolean;
  evidence: unknown;
}): NormalizedChangeDraft {
  const evidence = row.evidence as { affectedSymbols?: string[] } | null;
  return {
    changeType: row.changeType as ChangeType,
    oldValue: row.oldValue ?? undefined,
    newValue: row.newValue ?? undefined,
    description: row.description ?? undefined,
    breaking: row.breaking,
    affectedSymbols: evidence?.affectedSymbols ?? [],
    evidence: evidence ?? undefined,
  };
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}

function usageLine(usage: { astLocation: unknown; codeExcerpt: unknown }): number {
  const ast = usage.astLocation as { line?: unknown } | null;
  const excerpt = usage.codeExcerpt as { line?: unknown } | null;
  const line = ast?.line ?? excerpt?.line;
  return typeof line === "number" ? line : 1;
}

function usageExcerpt(usage: { codeExcerpt: unknown }): string {
  const excerpt = usage.codeExcerpt as { text?: unknown } | null;
  return typeof excerpt?.text === "string" ? excerpt.text : "";
}
