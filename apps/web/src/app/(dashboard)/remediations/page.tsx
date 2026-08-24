import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
  Card,
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
import { formatDate, PLAN_STATUS_TONE } from "@/lib/format";
import { GenerationMethod } from "@patchbay/domain";

export const metadata: Metadata = {
  title: "Remediations",
};

export default async function RemediationsPage() {
  const user = await requireRole("VIEWER");

  const plans = await prisma.remediationPlan.findMany({
    where: { impactAssessment: { repository: { organizationId: user.organizationId } } },
    orderBy: { createdAt: "desc" },
    include: {
      impactAssessment: {
        include: { changeEvent: true, repository: true },
      },
      patches: true,
      validations: true,
      pullRequests: true,
    },
    take: 100,
  });

  const stageCounts = {
    planning: plans.filter((p) => p.status === "DRAFT").length,
    validation: plans.filter((p) => ["READY_FOR_VALIDATION", "VALIDATING"].includes(p.status))
      .length,
    approval: plans.filter((p) => p.validations.some((v) => v.status === "PASSED")).length,
    draftPr: plans.filter((p) => p.pullRequests.length > 0).length,
  };
  const stages = [
    { label: "Planning", count: stageCounts.planning },
    { label: "Validation", count: stageCounts.validation },
    { label: "Approval", count: stageCounts.approval },
    { label: "Draft PR", count: stageCounts.draftPr },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Remediations</h1>
        <p className="mt-1 text-sm text-ink-400">
          Migration plans, patches, validation runs, and pull requests.
        </p>
      </div>

      {/* Funnel visualization */}
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-y-3">
          {stages.map((stage, i) => (
            <div key={stage.label} className="flex items-center">
              {i > 0 ? (
                <span aria-hidden="true" className="mx-3 text-ink-600">
                  →
                </span>
              ) : null}
              <div className="rounded-lg border border-ink-700 bg-ink-800/60 px-4 py-2 text-center transition-colors hover:border-accent-500/40">
                <p className="text-lg font-bold tabular-nums leading-none text-white">
                  {stage.count}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-ink-400">
                  {stage.label}
                </p>
              </div>
            </div>
          ))}
          <span
            aria-hidden="true"
            className="ml-3 rounded-md border border-mint-400/20 bg-mint-400/5 px-2 py-1 text-[10px] uppercase tracking-wider text-mint-400"
          >
            Merged → outcomes
          </span>
        </div>
      </Card>

      {plans.length === 0 ? (
        <EmptyState
          title="No remediation plans yet"
          description="Run a demo scenario to generate a remediation end to end: analysis, patch, validation, and a mock draft pull request."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Plan</TableHeaderCell>
              <TableHeaderCell>Repository</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Method</TableHeaderCell>
              <TableHeaderCell>Confidence</TableHeaderCell>
              <TableHeaderCell>Validation</TableHeaderCell>
              <TableHeaderCell>PR</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.map((plan) => {
              const latestValidation = [...plan.validations].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
              )[0];
              const pr = plan.pullRequests[0];
              return (
                <TableRow key={plan.id}>
                  <TableCell>
                    <Link
                      href={`/remediations/${plan.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {plan.impactAssessment.changeEvent.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{plan.impactAssessment.repository.name}</TableCell>
                  <TableCell>
                    <StatusPill label={plan.status} tone={PLAN_STATUS_TONE[plan.status]} />
                  </TableCell>
                  <TableCell className="text-xs">{methodLabel(plan)}</TableCell>
                  <TableCell className="tabular-nums">{plan.confidence}</TableCell>
                  <TableCell className="text-xs">
                    {latestValidation ? latestValidation.status : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {pr ? (
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        draft PR
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-ink-400">
                    {formatDate(plan.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function methodLabel(plan: { patches: Array<{ generationMethod: GenerationMethod }> }): string {
  if (plan.patches.length === 0) return "Plan only";
  const methods = new Set(plan.patches.map((p) => p.generationMethod));
  if (methods.has("RULE_BASED")) return "Rule-based";
  if (methods.has("AI_ASSISTED")) return "AI-assisted";
  return "Manual";
}
