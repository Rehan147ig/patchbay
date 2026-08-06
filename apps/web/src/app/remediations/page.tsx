import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Remediations</h1>
        <p className="text-sm text-slate-500">
          Migration plans, patches, validation runs, and pull requests.
        </p>
      </div>

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
                  <TableCell className="text-xs text-slate-500">
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
