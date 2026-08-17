import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeBlock,
  EmptyState,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@patchbay/ui";
import { requireRole } from "@/lib/auth";
import { ValidatePlanButton } from "@/components/validate-plan-button";
import { ApprovePlanButton } from "@/components/approve-plan-button";
import { CreatePRButton } from "@/components/create-pr-button";
import { formatDate, PLAN_STATUS_TONE, PR_STATUS_TONE, VALIDATION_STATUS_TONE } from "@/lib/format";

export const metadata: Metadata = {
  title: "Remediation detail",
};

export default async function RemediationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole("VIEWER");
  const { id } = await params;

  const plan = await prisma.remediationPlan.findFirst({
    where: { id, impactAssessment: { repository: { organizationId: user.organizationId } } },
    include: {
      impactAssessment: {
        include: {
          changeEvent: { include: { vendor: true, normalizations: true } },
          repository: true,
          affectedUsages: { include: { usage: true } },
        },
      },
      patches: true,
      validations: { orderBy: { createdAt: "asc" } },
      pullRequests: true,
      approvals: { include: { user: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!plan) notFound();

  const { impactAssessment } = plan;
  const latestApproval = plan.approvals[0];
  const policyDecision =
    plan.policyDecision && typeof plan.policyDecision === "object"
      ? (plan.policyDecision as {
          decision?: string;
          reasons?: string[];
          matchedPolicyIds?: string[];
        })
      : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/remediations" className="text-blue-600 hover:underline">
            Remediations
          </Link>{" "}
          /
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">
            {impactAssessment.changeEvent.title}
          </h1>
          <StatusPill label={plan.status} tone={PLAN_STATUS_TONE[plan.status]} />
          <Badge tone={plan.requiresHumanReview ? "amber" : "green"}>
            {plan.requiresHumanReview ? "requires human review" : "no approval required"}
          </Badge>
          <ValidatePlanButton remediationPlanId={plan.id} disabled={plan.patches.length === 0} />
          {plan.requiresHumanReview ? (
            <ApprovePlanButton
              remediationPlanId={plan.id}
              currentDecision={latestApproval?.decision}
            />
          ) : null}
          <CreatePRButton
            remediationPlanId={plan.id}
            disabled={plan.patches.length === 0 || plan.pullRequests.length > 0}
          />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {impactAssessment.repository.name} · confidence {plan.confidence} · created{" "}
          {formatDate(plan.createdAt)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Source change</CardTitle>
            <CardDescription>What changed in the vendor API/SDK.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-slate-700">{impactAssessment.changeEvent.title}</p>
            <p className="text-xs text-slate-500">
              Vendor: {impactAssessment.changeEvent.vendor.name} · Severity:{" "}
              {impactAssessment.changeEvent.severity}
            </p>
            {impactAssessment.changeEvent.normalizations.length > 0 ? (
              <ul className="space-y-1 text-xs text-slate-600">
                {impactAssessment.changeEvent.normalizations.map((normalization) => (
                  <li key={normalization.id}>
                    <Badge tone={normalization.breaking ? "red" : "green"} className="mr-1">
                      {normalization.breaking ? "breaking" : "compatible"}
                    </Badge>
                    {normalization.description ?? normalization.changeType}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Impact assessment</CardTitle>
            <CardDescription>Why this repository is affected.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Impact</p>
                <p className="text-lg font-semibold tabular-nums">{impactAssessment.score}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Confidence</p>
                <p className="text-lg font-semibold tabular-nums">{impactAssessment.confidence}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Risk</p>
                <p className="text-lg font-semibold">{impactAssessment.riskLevel}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600">{impactAssessment.rationale}</p>
            <p className="text-xs text-slate-500">
              {impactAssessment.affectedUsageCount} affected usages · status{" "}
              {impactAssessment.status}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Affected usages</CardTitle>
          <CardDescription>Exact code locations matched by this change.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {impactAssessment.affectedUsages.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">No usages linked to this assessment.</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>File</TableHeaderCell>
                  <TableHeaderCell>Symbol</TableHeaderCell>
                  <TableHeaderCell>Owner</TableHeaderCell>
                  <TableHeaderCell>Excerpt</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {impactAssessment.affectedUsages.map(({ usage }) => (
                  <TableRow key={usage.id}>
                    <TableCell className="font-mono text-xs">
                      {usage.filePath}
                      {usage.astLocation &&
                      typeof usage.astLocation === "object" &&
                      "line" in usage.astLocation
                        ? `:${String(usage.astLocation.line)}`
                        : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{usage.symbol}</TableCell>
                    <TableCell className="text-xs">{usage.ownerHint}</TableCell>
                    <TableCell className="max-w-sm">
                      <CodeBlock maxHeight="6rem" className="whitespace-pre-wrap break-all">
                        {usage.codeExcerpt &&
                        typeof usage.codeExcerpt === "object" &&
                        "text" in usage.codeExcerpt
                          ? String(usage.codeExcerpt.text)
                          : "—"}
                      </CodeBlock>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Policy decision</CardTitle>
            <CardDescription>How policy governed this remediation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {policyDecision ? (
              <>
                <p className="text-sm font-medium text-slate-800">
                  Decision: <span className="font-mono">{policyDecision.decision}</span>
                </p>
                {policyDecision.matchedPolicyIds && policyDecision.matchedPolicyIds.length > 0 ? (
                  <p className="text-xs text-slate-500">
                    Matched policies: {policyDecision.matchedPolicyIds.join(", ")}
                  </p>
                ) : null}
                {policyDecision.reasons && policyDecision.reasons.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
                    {policyDecision.reasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-slate-500">No policy decision recorded yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approvals</CardTitle>
            <CardDescription>Human decisions recorded against this plan.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {plan.approvals.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                {plan.requiresHumanReview
                  ? "Approval required before a pull request can be created."
                  : "No approvals required."}
              </p>
            ) : (
              <Table className="rounded-none border-0 shadow-none">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Decision</TableHeaderCell>
                    <TableHeaderCell>By</TableHeaderCell>
                    <TableHeaderCell>Note</TableHeaderCell>
                    <TableHeaderCell>When</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {plan.approvals.map((approval) => (
                    <TableRow key={approval.id}>
                      <TableCell>
                        <Badge tone={approval.decision === "APPROVED" ? "green" : "red"}>
                          {approval.decision}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{approval.user.name}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {approval.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatDate(approval.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Patch artifacts</CardTitle>
          <CardDescription>Proposed diffs and generation method.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plan.patches.length === 0 ? (
            <EmptyState
              title="No patch generated"
              description="This plan is plan-only or AI-assisted. Patches are produced only by deterministic rules for known patterns."
            />
          ) : (
            plan.patches.map((patch) => (
              <div key={patch.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs text-slate-700">{patch.filePath}</code>
                  <Badge tone="blue">{patch.generationMethod}</Badge>
                  <Badge tone="neutral">confidence {patch.confidence}</Badge>
                  <span className="text-xs text-slate-400">
                    {patch.originalHash.slice(0, 8)} → {patch.patchedHash.slice(0, 8)}
                  </span>
                </div>
                <CodeBlock>{patch.unifiedDiff}</CodeBlock>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Validation runs</CardTitle>
          <CardDescription>Allowlisted commands executed in the sandbox.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {plan.validations.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">No validation runs yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {plan.validations.map((validation) => (
                <div key={validation.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={validation.status}
                      tone={VALIDATION_STATUS_TONE[validation.status]}
                    />
                    <span className="font-mono text-xs text-slate-600">
                      {(validation.commands as string[]).join(" && ")}
                    </span>
                    <span className="text-xs text-slate-400">
                      {validation.completedAt
                        ? formatDate(validation.completedAt)
                        : formatDate(validation.createdAt)}
                    </span>
                    {validation.exitCode !== null && validation.exitCode !== undefined ? (
                      <span className="text-xs text-slate-500">exit {validation.exitCode}</span>
                    ) : null}
                  </div>
                  {validation.stdout ? (
                    <CodeBlock maxHeight="10rem" className="bg-slate-900">
                      {validation.stdout}
                    </CodeBlock>
                  ) : null}
                  {validation.stderr ? (
                    <CodeBlock maxHeight="10rem" className="bg-red-950">
                      {validation.stderr}
                    </CodeBlock>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pull request</CardTitle>
          <CardDescription>Draft PR created through the git provider.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {plan.pullRequests.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              No pull request yet. Draft PRs are created only after validation passes and policy
              allows.
            </p>
          ) : (
            <Table className="rounded-none border-0 shadow-none">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Provider</TableHeaderCell>
                  <TableHeaderCell>Branch</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>URL</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {plan.pullRequests.map((pr) => (
                  <TableRow key={pr.id}>
                    <TableCell className="text-xs">{pr.provider}</TableCell>
                    <TableCell className="font-mono text-xs">{pr.branchName}</TableCell>
                    <TableCell>
                      <StatusPill label={pr.status} tone={PR_STATUS_TONE[pr.status]} />
                    </TableCell>
                    <TableCell>
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {pr.url}
                      </a>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDate(pr.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
