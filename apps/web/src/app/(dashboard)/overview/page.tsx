import type { Metadata } from "next";
import Link from "next/link";
import { GitBranch, Package, AlertTriangle, ShieldAlert, Clock, CheckCircle2 } from "lucide-react";
import { prisma } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  StatCard,
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

  const stats = [
    {
      label: "Active repositories",
      value: repositoryCount,
      hint: "Connected to Patch",
      icon: <GitBranch aria-hidden="true" />,
    },
    {
      label: "Monitored vendors",
      value: vendorCount,
      hint: "Catalog entries",
      icon: <Package aria-hidden="true" />,
    },
    {
      label: "Open change events",
      value: openChangeCount,
      tone: openChangeCount > 0 ? ("amber" as const) : ("neutral" as const),
      hint: "Detected, triaged, or remediating",
      icon: <AlertTriangle aria-hidden="true" />,
    },
    {
      label: "Affected repositories",
      value: affectedRepoCount,
      tone: affectedRepoCount > 0 ? ("red" as const) : ("neutral" as const),
      hint: "Assessed as affected by a change",
      icon: <ShieldAlert aria-hidden="true" />,
    },
    {
      label: "Plans awaiting approval",
      value: plansPendingApproval,
      tone: plansPendingApproval > 0 ? ("amber" as const) : ("neutral" as const),
      hint: "Require human review",
      icon: <Clock aria-hidden="true" />,
    },
    {
      label: "Validation pass rate",
      value: validationRate === null ? "—" : `${validationRate}%`,
      tone:
        validationRate !== null && validationRate >= 80 ? ("green" as const) : ("neutral" as const),
      hint:
        totalValidations === 0
          ? "No validation runs yet"
          : `${passedValidations} of ${totalValidations} runs passed`,
      icon: <CheckCircle2 aria-hidden="true" />,
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Overview</h1>
          <p className="mt-1 text-sm text-ink-400">
            Remediation health ·{" "}
            {user.organizationId === "org-acme" ? "Acme SaaS workspace" : "your workspace"} · local
            demo data
          </p>
        </div>
        <Badge tone="blue">Live</Badge>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="animate-slide-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <StatCard {...stat} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent audit events</CardTitle>
            <CardDescription>
              <Link href="/audit" className="text-accent-400 hover:underline">
                View full audit trail →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {recentAuditEvents.length === 0 ? (
              <EmptyState
                title="No audit events yet"
                description="Important actions will appear here."
              />
            ) : (
              recentAuditEvents.map((event) => (
                <div
                  key={event.id}
                  className="border-l-2 border-accent-500/30 pl-3 transition-colors hover:border-accent-500/70"
                >
                  <p className="text-[11px] uppercase tracking-wider text-ink-500">
                    {formatDate(event.createdAt)}
                  </p>
                  <p className="font-mono text-xs text-gray-200">{event.action}</p>
                  <p className="text-[11px] text-ink-500">
                    {event.actorType === ActorType.SYSTEM
                      ? "system"
                      : (event.actorId?.replace("user-", "") ?? "—")}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>What you can do with this demo environment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              {
                href: "/repositories",
                title: "Repositories",
                body: "Inspect the seeded integration usage inventory for billing, AI, notifications, and auth services.",
              },
              {
                href: "/changes",
                title: "Changes",
                body: "Review detected vendor change events and their normalized classifications.",
              },
              {
                href: "/policies",
                title: "Policies",
                body: "View and toggle the approval gates that govern remediation.",
              },
            ].map((step, i) => (
              <Link
                key={step.href}
                href={step.href}
                className="group flex items-start gap-4 rounded-lg p-1.5 transition-colors hover:bg-ink-700/40"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-ink-600 bg-ink-700 text-xs font-bold text-accent-400 transition-all group-hover:border-accent-500 group-hover:text-accent-300"
                >
                  {i + 1}
                </span>
                <span>
                  <span className="block font-medium text-gray-100">{step.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
                    {step.body}
                  </span>
                </span>
              </Link>
            ))}
            <p className="px-1 pb-1 pt-2 text-xs leading-relaxed text-ink-500">
              Run the guided demo scenarios from the Demo page to see change detection, impact
              analysis, patch generation, validation, and draft PR creation end to end.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-ink-500">
        Demo data seed:{" "}
        {truncate(
          "Acme SaaS · billing-service, ai-assistant-service, notification-service, auth-gateway",
          100,
        )}
      </p>
    </div>
  );
}
