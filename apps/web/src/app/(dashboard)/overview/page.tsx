import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
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
import { requireUser } from "@/lib/auth";
import { formatDate, truncate } from "@/lib/format";
import { ActorType } from "@patchbay/domain";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function OverviewPage() {
  const user = await requireUser();
  const orgId = user.organizationId;

  const [
    repositoryCount,
    vendorCount,
    openChangeCount,
    affectedRepoCount,
    plansPendingApproval,
    validationRuns,
    recentAuditEvents,
  ] = await Promise.all([
    prisma.repository.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
    prisma.vendor.count({ where: { enabled: true } }),
    prisma.vendorChangeEvent.count({
      where: {
        organizationId: orgId,
        status: { in: ["DETECTED", "TRIAGED", "REMEDIATION_STARTED"] },
      },
    }),
    prisma.impactAssessment.count({
      where: {
        repository: { organizationId: orgId },
        status: "AFFECTED",
      },
    }),
    prisma.remediationPlan.count({
      where: {
        impactAssessment: { repository: { organizationId: orgId } },
        requiresHumanReview: true,
        status: { in: ["READY_FOR_VALIDATION", "VALIDATED", "BLOCKED"] },
        approvals: { none: {} },
      },
    }),
    prisma.validationRun.findMany({
      select: { status: true },
      where: {
        remediationPlan: {
          impactAssessment: { repository: { organizationId: orgId } },
        },
      },
    }),
    prisma.auditEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const totalValidations = validationRuns.length;
  const passedValidations = validationRuns.filter((v) => v.status === "PASSED").length;
  const validationRate =
    totalValidations > 0 ? Math.round((passedValidations / totalValidations) * 100) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">
          Remediation health for{" "}
          {user.organizationId === "org-acme" ? "Acme SaaS" : "your workspace"}. All figures are
          local demo data.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Active repositories"
          value={repositoryCount}
          hint="Connected to Patchbay"
        />
        <StatCard label="Monitored vendors" value={vendorCount} hint="Catalog entries" />
        <StatCard
          label="Open change events"
          value={openChangeCount}
          tone={openChangeCount > 0 ? "amber" : "neutral"}
          hint="Detected, triaged, or remediating"
        />
        <StatCard
          label="Affected repositories"
          value={affectedRepoCount}
          tone={affectedRepoCount > 0 ? "red" : "neutral"}
          hint="Assessed as affected by a change"
        />
        <StatCard
          label="Plans awaiting approval"
          value={plansPendingApproval}
          tone={plansPendingApproval > 0 ? "amber" : "neutral"}
          hint="Require human review"
        />
        <StatCard
          label="Validation pass rate"
          value={validationRate === null ? "—" : `${validationRate}%`}
          hint={
            totalValidations === 0
              ? "No validation runs yet"
              : `${passedValidations} of ${totalValidations} runs passed`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent audit events</CardTitle>
            <CardDescription>
              <Link href="/audit" className="text-blue-600 hover:underline">
                View full audit trail
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {recentAuditEvents.length === 0 ? (
              <div className="px-4 py-3">
                <EmptyState
                  title="No audit events yet"
                  description="Important actions will appear here."
                />
              </div>
            ) : (
              <Table className="rounded-none border-0 shadow-none">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>When</TableHeaderCell>
                    <TableHeaderCell>Action</TableHeaderCell>
                    <TableHeaderCell>Actor</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentAuditEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-xs text-slate-500">
                        {formatDate(event.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{event.action}</TableCell>
                      <TableCell className="text-xs">
                        {event.actorType === ActorType.SYSTEM
                          ? "system"
                          : (event.actorId?.replace("user-", "") ?? "—")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>What you can do with this demo environment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <p>
              <Link href="/repositories" className="font-medium text-blue-600 hover:underline">
                Repositories
              </Link>{" "}
              — inspect the seeded integration usage inventory for billing, AI, notifications, and
              auth services.
            </p>
            <p>
              <Link href="/changes" className="font-medium text-blue-600 hover:underline">
                Changes
              </Link>{" "}
              — review detected vendor change events and their normalized classifications.
            </p>
            <p>
              <Link href="/policies" className="font-medium text-blue-600 hover:underline">
                Policies
              </Link>{" "}
              — view and toggle the approval gates that govern remediation.
            </p>
            <p>
              Run the guided demo scenarios from the Demo page to see change detection, impact
              analysis, patch generation, validation, and draft PR creation end to end.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-slate-400">
        Demo data seed:{" "}
        {truncate(
          "Acme SaaS · billing-service, ai-assistant-service, notification-service, auth-gateway",
          100,
        )}
      </p>
    </div>
  );
}
