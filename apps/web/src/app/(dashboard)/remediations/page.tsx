import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
  Card,
  CardContent,
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
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <div className="border-b border-zinc-200/60 pb-6">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f] antialiased">
          Remediations
        </h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
          Migration plans, patches, validation runs, and pull requests.
        </p>
      </div>

      {/* Funnel visualization — Apple segmented control */}
      <Card className="rounded-[20px] border-zinc-200 bg-white px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-full bg-zinc-100 p-1">
            {stages.map((stage) => (
              <div
                key={stage.label}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-zinc-200/60"
              >
                <span className="text-[13px] font-semibold tracking-tight tabular-nums text-[#1d1d1f]">
                  {stage.count}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
                  {stage.label}
                </span>
              </div>
            ))}
          </div>
          <span className="inline-flex items-center rounded-full border border-[#34c759]/20 bg-[#34c759]/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest text-[#34c759]">
            Merged → outcomes
          </span>
        </div>
      </Card>

      {plans.length === 0 ? (
        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardContent className="px-6 py-8">
            <EmptyState
              title="No remediation plans yet"
              description="Run a demo scenario to generate a remediation end to end: analysis, patch, validation, and a mock draft pull request."
            />
          </CardContent>
        </Card>
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
                <TableRow key={plan.id} className="group">
                  <TableCell>
                    <Link
                      href={`/remediations/${plan.id}`}
                      className="text-[13px] font-semibold tracking-tight text-[#0071e3] hover:underline"
                    >
                      {plan.impactAssessment.changeEvent?.title ?? "Contract assessment"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-[12px] font-medium tracking-tight text-[#1d1d1f]">
                    {plan.impactAssessment.repository.name}
                  </TableCell>
                  <TableCell>
                    <StatusPill label={plan.status} tone={PLAN_STATUS_TONE[plan.status]} />
                  </TableCell>
                  <TableCell className="text-[12px] text-zinc-500">{methodLabel(plan)}</TableCell>
                  <TableCell className="text-[13px] font-medium tabular-nums text-[#1d1d1f]">
                    {plan.confidence}
                  </TableCell>
                  <TableCell className="text-[12px] text-zinc-500">
                    {latestValidation ? latestValidation.status : "—"}
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {pr ? (
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium tracking-wide text-[#0071e3] shadow-sm hover:border-[#0071e3]/20 hover:bg-[#0071e3]/5 hover:text-[#0077ed]"
                      >
                        draft PR
                      </a>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[12px] text-zinc-500">
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
