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
import { CaseReasonCode, PlanStatus } from "@patchbay/domain";
import { evaluateQuorum } from "@patchbay/policy-engine";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { CaseActions, type CaseAction } from "@/components/case-actions";
import { PlanRunButton } from "@/components/plan-run-button";
import { AgentOrbsPanel } from "@/components/agent-orbs-panel";
import { BlastRadar } from "@/components/blast-radar";

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
          impactAssessment: {
            include: {
              affectedUsages: {
                include: {
                  usage: {
                    include: { vendor: { select: { slug: true } } },
                  },
                },
              },
            },
          },
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

  // Bounded 2-hop blast radar data (server-computed, deterministic):
  // center = changed package@version, ring 1 = affected usages from the
  // latest plan's impact assessment (strict exact-symbol matches only),
  // ring 2 = other indexed usages co-located in the same files.
  const radarAffected =
    latestPlan?.impactAssessment?.affectedUsages
      .map((item) => item.usage)
      .filter((usage) => typeof usage.symbol === "string" && usage.symbol.length > 0)
      .slice(0, 40) ?? [];
  const radarFiles = [...new Set(radarAffected.map((usage) => usage.filePath))];
  const radarColocated =
    radarFiles.length === 0
      ? []
      : await prisma.integrationUsage.findMany({
          where: {
            organizationId: user.organizationId,
            repositoryId: remediationCase.repository.id,
            filePath: { in: radarFiles },
            id: { notIn: radarAffected.map((usage) => usage.id) },
          },
          select: {
            id: true,
            filePath: true,
            symbol: true,
            usageType: true,
            riskTags: true,
            vendor: { select: { slug: true } },
          },
          orderBy: [{ filePath: "asc" }, { symbol: "asc" }],
          take: 110,
        });
  const radarData = {
    packageName: remediationCase.release.product.packageName,
    version: remediationCase.release.version,
    affected: radarAffected.map((usage) => ({
      id: usage.id,
      filePath: usage.filePath,
      symbol: usage.symbol,
      usageType: usage.usageType,
      riskTags: (usage.riskTags as string[]) ?? [],
      vendorSlug: usage.vendor.slug,
    })),
    colocated: radarColocated.map((usage) => ({
      id: usage.id,
      filePath: usage.filePath,
      symbol: usage.symbol,
      usageType: usage.usageType,
      riskTags: (usage.riskTags as string[]) ?? [],
      vendorSlug: usage.vendor.slug,
    })),
  };

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
  // Two-person rule status for the latest plan: quorum-tagged plans
  // (PAYMENT/AUTH/ENCRYPTION/SECRETS) need two DISTINCT covering approvers.
  // Display-only here — enforcement lives in draft-pr + create-pr gates.
  const quorumRiskTags = Array.from(
    new Set(
      (latestPlan?.impactAssessment?.affectedUsages ?? []).flatMap(
        (u) => (u.usage.riskTags as string[]) ?? [],
      ),
    ),
  );
  const quorum = latestPlan
    ? evaluateQuorum(
        latestPlan.approvals.map((approval) => ({
          userId: approval.userId,
          decision: approval.decision,
          patchedHash: approval.patchedHash,
          expiresAt: approval.expiresAt,
        })),
        latestPlan.patches.map((patch) => patch.patchedContent),
        quorumRiskTags,
      )
    : null;
  const quorumHint =
    quorum && quorum.required && !quorum.satisfied
      ? `Two-person rule: ${quorum.approverCount}/${quorum.requiredCount} distinct approvals — one more reviewer required (${quorum.matchedTags.join(", ")}).`
      : null;
  // Unified funnel button: only when the case awaits approval AND the latest
  // plan is already VALIDATED (draft-pr requires validation passed + approval
  // coverage). Otherwise the user sees exactly why it is unavailable.
  const unifiedReady =
    remediationCase.status === "APPROVAL_REQUIRED" && latestPlan?.status === PlanStatus.VALIDATED;
  const unifiedBlockedReason =
    remediationCase.status === "APPROVAL_REQUIRED" && !unifiedReady
      ? "Plan validation pending — Approve & Open Draft PR unlocks once the plan is validated."
      : null;
  if (unifiedReady) actions.push("approve-and-draft-pr");
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
      <div className="relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-800/80 p-5 backdrop-blur-xl">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-gradient-to-br from-accent-400/25 to-accent-600/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-400/50 to-transparent"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-600 font-bold text-white shadow-[0_8px_24px_-8px_rgba(99,102,241,0.6)] ${
                remediationCase.status === "VALIDATING" || remediationCase.status === "PLANNING"
                  ? "ring-2 ring-accent-500/50 ring-offset-2 ring-offset-ink-800 animate-pulse-ring"
                  : ""
              }`}
            >
              {remediationCase.release.product.packageName.charAt(0).toUpperCase()}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-white">
                  {remediationCase.release.product.packageName}{" "}
                  <span className="text-ink-400">v{remediationCase.release.version}</span>
                </h1>
                <StatusPill
                  label={remediationCase.status}
                  tone={STATUS_TONE[remediationCase.status] ?? "neutral"}
                />
              </div>
              <p className="mt-0.5 text-sm text-ink-400">
                {remediationCase.release.product.vendor.name} (
                {remediationCase.release.product.vendor.slug}) ·{" "}
                {remediationCase.repository.fullName} · resolved{" "}
                {remediationCase.dependency.resolvedVersion} ·{" "}
                {remediationCase.dependency.lockfileKind}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canPlan && remediationCase.releaseRepositoryMatchId ? (
              <PlanRunButton
                releaseId={remediationCase.release.id}
                matchId={remediationCase.releaseRepositoryMatchId}
              />
            ) : null}
            {actions.length > 0 ? (
              <CaseActions caseId={remediationCase.id} actions={actions} />
            ) : null}
            {unifiedBlockedReason ? (
              <p className="basis-full text-right text-[11px] text-ink-500">
                {unifiedBlockedReason}
              </p>
            ) : null}
            {quorumHint ? (
              <p className="basis-full text-right text-[11px] font-medium text-amber-500">
                {quorumHint}
              </p>
            ) : null}
          </div>
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
                <p className="text-sm text-ink-400">No events recorded yet.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-ink-700 pl-6">
                  {remediationCase.events.map((event) => (
                    <li key={event.id} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute -left-[27.5px] flex size-4 items-center justify-center rounded-full border border-ink-700 bg-ink-800"
                      >
                        <span className="size-1.5 rounded-full bg-accent-500" />
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={event.status}
                          tone={STATUS_TONE[event.status] ?? "neutral"}
                        />
                        <p className="text-xs text-ink-500">{formatDate(event.createdAt)}</p>
                      </div>
                      {event.reasonCode ? (
                        <p className="mt-0.5 text-xs text-ink-400">
                          {REASON_LABEL[event.reasonCode] ?? event.reasonCode}
                        </p>
                      ) : null}
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
                    <span className="text-ink-400">
                      confidence {latestPlan.confidence}% · {latestPlan.patches.length} patch
                      {latestPlan.patches.length === 1 ? "" : "es"}
                      {latestPlan.requiresHumanReview ? " · human review required" : ""}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-ink-400">
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
                          className="text-accent-400 hover:underline"
                        >
                          {latestPR.branchName}
                        </a>
                      </p>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-400">
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
                  <div className="flex items-center gap-3">
                    <div
                      role="meter"
                      aria-valuenow={blastRadius.score}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Blast radius score ${blastRadius.score}`}
                      className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700"
                    >
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-accent-600 to-red-500"
                        style={{ width: `${Math.min(100, Math.max(0, blastRadius.score))}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold tabular-nums text-white">
                      {blastRadius.score}
                    </span>
                    <Badge
                      tone={
                        blastRadius.severity === "CRITICAL"
                          ? "red"
                          : blastRadius.severity === "HIGH"
                            ? "amber"
                            : "blue"
                      }
                    >
                      {blastRadius.severity}
                    </Badge>
                  </div>
                  <ul className="space-y-1 pt-1 text-xs text-ink-400">
                    {blastRadius.factors.map((factor) => (
                      <li key={factor} className="flex items-start gap-1.5">
                        <span
                          aria-hidden="true"
                          className="mt-1 size-1 shrink-0 rounded-full bg-ink-500"
                        />
                        {factor}
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-ink-700/60 pt-3">
                    <BlastRadar data={radarData} />
                  </div>
                </>
              ) : (
                <p className="text-sm text-ink-400">No blast radius computed.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Funnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-ink-400">
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
