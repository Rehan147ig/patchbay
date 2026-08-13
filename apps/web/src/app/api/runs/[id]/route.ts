import { prisma } from "@patchbay/db";
import { validationFailed } from "@patchbay/domain";
import type { NextRequest } from "next/server";
import { getCorrelationId, jsonError, jsonOk } from "@/lib/api";
import { requireRole } from "@/lib/auth";

/**
 * GET /api/runs/[id] — one agent run with its step trace and, when the run
 * succeeded, the review verdict and bound plan (edits, invalidated files).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await requireRole("VIEWER");
    const { id } = await params;

    const run = await prisma.agentRun.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        releaseRecord: { select: { version: true, product: { select: { packageName: true } } } },
        repository: { select: { name: true, fullName: true } },
        steps: { orderBy: { startedAt: "asc" } },
      },
    });
    if (!run) {
      throw validationFailed("Agent run not found");
    }

    return jsonOk(
      {
        run: {
          id: run.id,
          status: run.status,
          type: run.type,
          packageName: run.releaseRecord.product.packageName,
          version: run.releaseRecord.version,
          repositoryName: run.repository.name,
          fullName: run.repository.fullName,
          model: run.model,
          promptTemplateVersion: run.promptTemplateVersion,
          costEstimateCents: run.costEstimateCents,
          budgetCents: run.budgetCents,
          tokenUsage: run.tokenUsage,
          error: run.error,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          createdAt: run.createdAt,
        },
        steps: run.steps.map((step) => ({
          id: step.id,
          role: step.role,
          kind: step.kind,
          status: step.status,
          toolName: step.toolName,
          inputDigest: step.inputDigest,
          latencyMs: step.latencyMs,
          error: step.error,
          startedAt: step.startedAt,
          completedAt: step.completedAt,
        })),
        verdict: outputReview(run.outputJson),
        plan: outputPlan(run.outputJson),
      },
      correlationId,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}

function outputReview(outputJson: unknown): unknown {
  if (typeof outputJson !== "object" || outputJson === null) return null;
  return (outputJson as { review?: unknown }).review ?? null;
}

function outputPlan(outputJson: unknown): unknown {
  if (typeof outputJson !== "object" || outputJson === null) return null;
  const plan = (outputJson as { plan?: unknown }).plan;
  if (typeof plan !== "object" || plan === null) return null;
  return plan;
}
