import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, agentStepSummary } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusPill,
} from "@patchbay/ui";
import { CaseReasonCode } from "@patchbay/domain";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { CaseActions, type CaseAction } from "@/components/case-actions";
import { PlanRunButton } from "@/components/plan-run-button";
import { AgentOrbsPanel } from "@/components/agent-orbs-panel";

export const metadata: Metadata = {
  title: "Remediation case",
};

const STATUS_TONE: Record<string, "neutral" | "blue" | "green" | "amber" | "red" | "purple"> = {
  OBSERVED: "neutral",
  EVIDENCE_VERIFIED: "neutral",
  IMPACT_CONFIRMED: "amber",
  POLICY_ELIGIBLE: "blue",
  PLANNING: "blue",
  PATCH_PROPOSED: "blue",
  VALIDATING: "blue",
  APPROVAL_REQUIRED: "amber",
  DRAFT_PR_CREATED: "purple",
  PLAN_ONLY: "neutral",
  REJECTED: "red",
  CANCELLED: "neutral",
  MERGED: "green",
  CLOSED: "green",
  LEARNED: "green",
};

const REASON_LABEL: Record<string, string> = {
  [CaseReasonCode.DEPENDENCY_MATCH]: "Dependency matched",
  [CaseReasonCode.USAGE_EVIDENCE]: "Usage evidence verified",
  [CaseReasonCode.CAPABILITY_UNSUPPORTED]: "Connector not certified for planning",
  [CaseReasonCode.POLICY_DENIED]: "Denied by tenant policy",
  [CaseReasonCode.INSUFFICIENT_EVIDENCE]: "Insufficient evidence",
  [CaseReasonCode.USER_REQUESTED]: "Requested by user",
  [CaseReasonCode.APPROVED]: "Approved",
  [CaseReasonCode.REPLAYED]: "Replayed",
  [CaseReasonCode.REJECTED_BY_OWNER]: "Rejected by owner",
  [CaseReasonCode.CANCELLED]: "Cancelled",
};

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("VIEWER");
  const { id } = await params;

  const remediationCase = await prisma.remediationCase.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      events: { orderBy: { createdAt: "desc" } },
      agentRuns: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          model: true,
          createdAt: true,
          steps: {
            orderBy: { startedAt: "asc" },
            select: {
              id: true,
              role: true,
              kind: true,
              status: true,
              toolName: true,
            },
          },
        },
      },
      plans: {
        include: {
          patches: true,
          validations: { orderBy: { createdAt: "desc" } },
          approvals: true,
          pullRequests: true,
        },
        orderBy: { createdAt: "desc" },
      },
      release: {
        select: {
          id: true,
          version: true,
          previousVersion: true,
          publishedAt: true,
          product: {
            select: { packageName: true, vendor: { select: { slug: true, name: true } } },
          },
        },
      },
      repository: { select: { id: true, fullName: true, defaultBranch: true } },
      dependency: {
        select: { packageName: true, resolvedVersion: true, commitSha: true, lockfileKind: true },
      },
      snapshot: { select: { id: true, commitSha: true, nodesAffected: true, edgesAffected: true } },
    },
  });
  if (!remediationCase) {
    notFound();
  }

  const blastRadius = (() => {
    const raw = remediationCase.blastRadius;
    if (typeof raw !== "object" || raw === null) return null;
    const parsed = raw as { score?: number; severity?: string; factors?: string[] };
    return {
      score: typeof parsed.score === "number" ? parsed.score : 0,
      severity: typeof parsed.severity === "string" ? parsed.severity : "LOW",
      factors: Array.isArray(parsed.factors) ? parsed.factors : [],
    };
  })();

  const policyDecision = (() => {
    const raw = remediationCase.policyDecision;
    if (typeof raw !== "object" || raw === null) return null;
    return raw as {
      decision?: string;
      requiresHumanReview?: boolean;
      deniedByPolicy?: string | null;
      reasons?: string[];
    };
  })();

  const latestPlan = remediationCase.plans[0];
  const latestPR = latestPlan?.pullRequests[0];

  const orbRuns = remediationCase.agentRuns.map((run) => ({
    id: run.id,
    status: run.status,
    model: run.model,
    createdAt: formatDate(run.createdAt),
    steps: run.steps.map((step) => ({
      id: step.id,
      role: step.role as "ANALYST" | "PLANNER" | "REVIEWER",
      status: step.status as "STARTED" | "COMPLETED" | "FAILED",
      summary: agentStepSummary(step),
    })),
  }));

  const actions: CaseAction[] = [];
  if (remediationCase.status === "APPROVAL_REQUIRED") actions.push("approve");
  if (
    remediationCase.status === "PATCH_PROPOSED" ||
    remediationCase.status === "APPROVAL_REQUIRED"
  ) {
    actions.push("draft-pr");
  }
  if (!["REJECTED", "CANCELLED", "MERGED", "CLOSED", "LEARNED"].includes(remediationCase.status)) {
    actions.push("cancel", "reject");
  }
  if (["REJECTED", "CANCELLED"].includes(remediationCase.status)) actions.push("replay");

  const canPlan =
    remediationCase.status === "POLICY_ELIGIBLE" || remediationCase.status === "PLANNING";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">
              {remediationCase.release.product.packageName}{" "}
              <span className="text-slate-400">v{remediationCase.release.version}</span>
            </h1>
            <StatusPill
              label={remediationCase.status}
              tone={STATUS_TONE[remediationCase.status] ?? "neutral"}
            />
          </div>
          <p className="text-sm text-slate-500">
            {remediationCase.release.product.vendor.name} (
            {remediationCase.release.product.vendor.slug}) · {remediationCase.repository.fullName} ·
            resolved {remediationCase.dependency.resolvedVersion} ·{" "}
            {remediationCase.dependency.lockfileKind}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canPlan && remediationCase.releaseRepositoryMatchId ? (
            <PlanRunButton
              releaseId={remediationCase.release.id}
              matchId={remediationCase.releaseRepositoryMatchId}
            />
          ) : null}
          {actions.length > 0 ? (
            <CaseActions caseId={remediationCase.id} actions={actions} />
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {remediationCase.events.length === 0 ? (
                <p className="text-sm text-slate-500">No events recorded yet.</p>
              ) : (
                <ol className="space-y-3">
                  {remediationCase.events.map((event) => (
                    <li key={event.id} className="flex items-start gap-3 text-sm">
                      <StatusPill
                        label={event.status}
                        tone={STATUS_TONE[event.status] ?? "neutral"}
                      />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">{formatDate(event.createdAt)}</p>
                        {event.reasonCode ? (
                          <p className="text-xs text-slate-500">
                            {REASON_LABEL[event.reasonCode] ?? event.reasonCode}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan</CardTitle>
              <CardDescription>
                The latest remediation plan linked to this case, its validation runs and pull
                request.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestPlan ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <StatusPill
                      label={latestPlan.status}
                      tone={latestPlan.status === "PR_CREATED" ? "purple" : "blue"}
                    />
                    <span className="text-slate-600">
                      confidence {latestPlan.confidence}% · {latestPlan.patches.length} patch
                      {latestPlan.patches.length === 1 ? "" : "es"}
                      {latestPlan.requiresHumanReview ? " · human review required" : ""}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600">
                    <p>
                      Validations:{" "}
                      {latestPlan.validations.map((v) => v.status).join(", ") || "none yet"}
                    </p>
                    <p>
                      Approvals:{" "}
                      {latestPlan.approvals
                        .map((a) => `${a.decision} (${formatDate(a.createdAt)})`)
                        .join(", ") || "none"}
                    </p>
                    {latestPR ? (
                      <p>
                        Pull request:{" "}
                        <a
                          href={latestPR.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {latestPR.branchName}
                        </a>
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">
                  No plan linked to this case yet. Plans are linked once the agent workflow produces
                  one.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Blast radius</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {blastRadius ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        blastRadius.severity === "CRITICAL"
                          ? "red"
                          : blastRadius.severity === "HIGH"
                            ? "amber"
                            : "blue"
                      }
                    >
                      {blastRadius.severity} · {blastRadius.score}
                    </Badge>
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
                    {blastRadius.factors.map((factor) => (
                      <li key={factor}>{factor}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-slate-500">No blast radius computed.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Funnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-slate-600">
              <p>
                Reason: {REASON_LABEL[remediationCase.reasonCode] ?? remediationCase.reasonCode}
              </p>
              <p>Connector capability: {remediationCase.capabilityLevel}</p>
              <p>Validation profile: {remediationCase.validationProfile ?? "not certified"}</p>
              {policyDecision ? (
                <>
                  <p>Policy decision: {policyDecision.decision}</p>
                  <p>
                    Human review: {policyDecision.requiresHumanReview ? "required" : "not required"}
                  </p>
                  {policyDecision.deniedByPolicy ? (
                    <p>Denied by: {policyDecision.deniedByPolicy}</p>
                  ) : null}
                </>
              ) : null}
              {remediationCase.terminalOutcome ? (
                <p>
                  Terminal outcome: {remediationCase.terminalOutcome} ·{" "}
                  {remediationCase.terminalAt ? formatDate(remediationCase.terminalAt) : ""}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <AgentOrbsPanel runs={orbRuns} />
        </div>
      </div>
    </div>
  );
}
