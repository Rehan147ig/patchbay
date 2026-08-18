import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import { computeOrganizationMetrics } from "@patchbay/operations";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@patchbay/ui";
import { PrOutcomeClassification } from "@patchbay/domain";
import { requireUser } from "@/lib/auth";
import {
  formatDate,
  OUTCOME_SOURCE_LABEL,
  PR_OUTCOME_CLASSIFICATION_LABEL,
  PR_OUTCOME_CLASSIFICATION_TONE,
} from "@/lib/format";
import { OutcomeFeedbackForm } from "@/components/outcome-feedback-form";

export const metadata: Metadata = {
  title: "Outcomes",
};

export default async function OutcomesPage() {
  const user = await requireUser();
  const orgId = user.organizationId;

  const [metrics, outcomes] = await Promise.all([
    computeOrganizationMetrics(prisma, { organizationId: orgId, windowDays: 30 }),
    prisma.prOutcome.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        pullRequest: {
          include: {
            remediationPlan: {
              include: {
                impactAssessment: {
                  include: {
                    repository: { select: { name: true } },
                    changeEvent: { include: { vendor: { select: { slug: true, name: true } } } },
                  },
                },
              },
            },
          },
        },
        case: { select: { id: true } },
      },
    }),
  ]);

  const unclassifiedTerminal = outcomes.filter(
    (outcome) =>
      outcome.classification === PrOutcomeClassification.UNCLASSIFIED &&
      (outcome.status === "MERGED" || outcome.status === "CLOSED"),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Outcomes</h1>
        <p className="text-sm text-slate-500">
          What happened after Patchbay acted — merged pull requests, human feedback, and the
          capability-health signals derived from them.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="PR merge rate"
          value={
            metrics.pullRequests.mergeRatePct === null
              ? "—"
              : `${metrics.pullRequests.mergeRatePct}%`
          }
          tone={
            metrics.pullRequests.mergeRatePct !== null && metrics.pullRequests.mergeRatePct < 50
              ? "red"
              : "neutral"
          }
          hint={`${metrics.pullRequests.merged} merged of ${metrics.pullRequests.merged + metrics.pullRequests.closed + metrics.pullRequests.open} in window`}
        />
        <StatCard
          label="False positive rate"
          value={
            metrics.outcomes.falsePositiveRatePct === null
              ? "—"
              : `${metrics.outcomes.falsePositiveRatePct}%`
          }
          tone={
            metrics.outcomes.falsePositiveRatePct !== null &&
            metrics.outcomes.falsePositiveRatePct > 50
              ? "red"
              : "neutral"
          }
          hint={`${metrics.outcomes.falsePositive} of ${metrics.outcomes.classified} classified outcomes`}
        />
        <StatCard
          label="Detection latency"
          value={
            metrics.detection.latencyP95Ms === null
              ? "—"
              : `${Math.round(metrics.detection.latencyP95Ms)}ms`
          }
          tone={
            metrics.detection.latencyP95Ms !== null && metrics.detection.latencyP95Ms > 60_000
              ? "amber"
              : "neutral"
          }
          hint="p95 across detection runs"
        />
        <StatCard
          label="Validation pass rate"
          value={metrics.sandbox.passRatePct === null ? "—" : `${metrics.sandbox.passRatePct}%`}
          hint={`${metrics.sandbox.passed} of ${metrics.sandbox.passed + metrics.sandbox.failed} runs passed`}
        />
        <StatCard
          label="Agent failure rate"
          value={metrics.agent.failureRatePct === null ? "—" : `${metrics.agent.failureRatePct}%`}
          hint={`${metrics.agent.runCount} runs in window`}
        />
        <StatCard
          label="Cost per successful remediation"
          value={
            metrics.agent.costPerSuccessfulRemediationCents === null
              ? "—"
              : `$${(metrics.agent.costPerSuccessfulRemediationCents / 100).toFixed(2)}`
          }
          hint={`${metrics.agent.budgetExceeded} runs over budget`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Merge rate signal</CardTitle>
            <CardDescription>Actionable pulls with a verdict.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-slate-700">
              <span className="font-medium text-slate-900">{metrics.outcomes.success}</span>{" "}
              success,
              <span className="font-medium text-slate-900">
                {" "}
                {metrics.outcomes.falsePositive}
              </span>{" "}
              false positives,
              <span className="font-medium text-slate-900">
                {" "}
                {metrics.outcomes.byClassification.UNCLASSIFIED ?? 0}
              </span>{" "}
              unclassified,{" "}
              <span className="font-medium text-slate-900"> {metrics.outcomes.total}</span> total
              outcomes in the window.
            </p>
            {metrics.outcomes.classified > 0 ? (
              <ul className="space-y-1">
                {Object.entries(metrics.outcomes.byClassification)
                  .filter(([, count]) => count > 0)
                  .map(([classification, count]) => (
                    <li key={classification} className="flex items-center gap-2">
                      <Badge
                        tone={
                          PR_OUTCOME_CLASSIFICATION_TONE[classification as PrOutcomeClassification]
                        }
                      >
                        {PR_OUTCOME_CLASSIFICATION_LABEL[classification as PrOutcomeClassification]}
                      </Badge>
                      <span className="text-xs text-slate-500">{count}</span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Feedback queue</CardTitle>
            <CardDescription>
              {unclassifiedTerminal.length} merged or closed pulls awaiting a human verdict.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {unclassifiedTerminal.length === 0 ? (
              <div className="px-4 py-3">
                <EmptyState
                  title="Nothing to classify"
                  description="Merged and closed pull requests will appear here for feedback."
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {unclassifiedTerminal.map((outcome) => (
                  <li
                    key={outcome.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                  >
                    <div className="text-xs">
                      <p className="font-medium text-slate-800">
                        {outcome.pullRequest?.url ? (
                          <a
                            href={outcome.pullRequest.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {outcome.pullRequest.branchName}
                          </a>
                        ) : (
                          (outcome.pullRequest?.branchName ?? "Pull request")
                        )}
                      </p>
                      <p className="text-slate-500">
                        {outcome.pullRequest.remediationPlan.impactAssessment.repository.name}
                        {outcome.pullRequest.remediationPlan.impactAssessment.changeEvent.vendor
                          ? ` · ${outcome.pullRequest.remediationPlan.impactAssessment.changeEvent.vendor.name}`
                          : ""}
                      </p>
                    </div>
                    <OutcomeFeedbackForm pullRequestId={outcome.pullRequestId} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Outcome ledger</CardTitle>
          <CardDescription>
            Every recorded outcome with its source, linkage, and verdict.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {outcomes.length === 0 ? (
            <div className="px-4 py-3">
              <EmptyState
                title="No outcomes yet"
                description="Outcomes are recorded when pull requests merge or close, or when you classify them here."
              />
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Pull request</TableHeaderCell>
                  <TableHeaderCell>Vendor</TableHeaderCell>
                  <TableHeaderCell>Verdict</TableHeaderCell>
                  <TableHeaderCell>Source</TableHeaderCell>
                  <TableHeaderCell>Linkage</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {outcomes.map((outcome) => (
                  <TableRow key={outcome.id}>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(outcome.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <p className="font-medium text-slate-800">
                        {outcome.pullRequest?.url ? (
                          <a
                            href={outcome.pullRequest.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {outcome.pullRequest.branchName}
                          </a>
                        ) : (
                          (outcome.pullRequest?.branchName ?? "—")
                        )}
                      </p>
                      <p className="text-slate-500">
                        {outcome.pullRequest?.remediationPlan.impactAssessment.repository.name ??
                          ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {outcome.pullRequest?.remediationPlan.impactAssessment.changeEvent.vendor
                        ?.name ?? "—"}
                      {outcome.case ? (
                        <span className="text-slate-400"> · {outcome.case.id.slice(0, 8)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge tone={PR_OUTCOME_CLASSIFICATION_TONE[outcome.classification]}>
                        {PR_OUTCOME_CLASSIFICATION_LABEL[outcome.classification]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {OUTCOME_SOURCE_LABEL[outcome.source]}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {outcome.rulePackVersion ? `rules ${outcome.rulePackVersion}` : ""}
                      {outcome.modelVersion ? ` · model ${outcome.modelVersion}` : ""}
                      {outcome.validationRunId ? " · validated" : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-400">
        SLO defaults: merge rate below 50%, false positive rate above 50%, or p95 detection latency
        above 60s over a 30-day window suspend the affected capability in Settings.
      </p>
    </div>
  );
}
