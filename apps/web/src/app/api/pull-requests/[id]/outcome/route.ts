import { prisma } from "@patchbay/db";
import {
  OutcomeSource,
  PrOutcomeClassification,
  PrOutcomeStatus,
  PullRequestStatus,
  notFound,
  validationFailed,
} from "@patchbay/domain";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { recordPrOutcome } from "@/lib/pr-outcomes";

/**
 * POST /api/pull-requests/[id]/outcome
 * Records human feedback (WP10) that classifies a remediation PR's result.
 * Source is USER_FEEDBACK; the classification replaces the webhook's initial
 * UNCLASSIFIED verdict. A new classification also re-runs capability health
 * evaluation (auto-suspend).
 */

const feedbackSchema = z.object({
  classification: z
    .nativeEnum(PrOutcomeClassification)
    .refine((value) => value !== PrOutcomeClassification.UNCLASSIFIED, {
      message: "A feedback classification is required",
    }),
  note: z.string().max(2_000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const { id } = await params;
    const body = await parseBody(request, feedbackSchema);

    const pullRequest = await prisma.pullRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      select: {
        id: true,
        status: true,
        remediationPlan: {
          select: {
            id: true,
            policyDecision: true,
            remediationCaseId: true,
            impactAssessment: {
              select: {
                changeEvent: { select: { vendor: { select: { slug: true } } } },
              },
            },
          },
        },
      },
    });
    if (!pullRequest) {
      throw notFound("Pull request not found");
    }

    const prOutcomeStatus =
      pullRequest.status === PullRequestStatus.MERGED
        ? PrOutcomeStatus.MERGED
        : pullRequest.status === PullRequestStatus.CLOSED
          ? PrOutcomeStatus.CLOSED
          : PrOutcomeStatus.OPEN;
    if (prOutcomeStatus === PrOutcomeStatus.OPEN) {
      throw validationFailed(
        "Outcome feedback is only meaningful for a merged or closed pull request",
      );
    }

    const result = await recordPrOutcome({
      organizationId: user.organizationId,
      pullRequestId: pullRequest.id,
      status: prOutcomeStatus,
      source: OutcomeSource.USER_FEEDBACK,
      classification: body.classification,
      note: body.note ?? null,
      recordedBy: user.id,
      planId: pullRequest.remediationPlan?.id ?? null,
      caseId: pullRequest.remediationPlan?.remediationCaseId ?? null,
      vendorSlug: pullRequest.remediationPlan?.impactAssessment.changeEvent.vendor.slug ?? null,
      policyDecision: pullRequest.remediationPlan?.policyDecision ?? null,
      correlationId,
    });

    return jsonOk(
      {
        pullRequestId: pullRequest.id,
        outcomeId: result.outcomeId,
        classification: body.classification,
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
