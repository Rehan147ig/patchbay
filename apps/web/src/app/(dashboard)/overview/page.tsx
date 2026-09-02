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
    <div className="space-y-8 bg-[#fbfbfd] font-sans antialiased">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f] antialiased">
            Overview
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
            Remediation health ·{" "}
            {user.organizationId === "org-acme" ? "Acme SaaS workspace" : "your workspace"} · local
            demo data
          </p>
        </div>
        <Badge tone="blue" variant="subtle">
          Live
        </Badge>
      </div>

      {repositoryCount === 0 ? (
        <Card className="rounded-[20px] border-zinc-200 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
          <CardContent className="p-8">
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#0071e3] text-white shadow-sm">
                  <GitBranch className="size-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">
                    Connect your first repository
                  </h2>
                  <p className="mt-1 max-w-[48ch] text-[13px] leading-relaxed text-zinc-500">
                    Install the GitHub App, connect a private repo, and Patch will prove its blast
                    radius on your real code — not demo data. Takes 2 minutes.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium tracking-tight text-white">
                      <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                      1. Install App
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium tracking-tight text-zinc-600">
                      2. Connect repo
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium tracking-tight text-zinc-600">
                      3. See blast radius
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                <Link
                  href="/onboarding"
                  className="inline-flex h-9 items-center justify-center rounded-full bg-[#0071e3] px-6 text-[13px] font-medium tracking-tight text-white shadow-sm hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/20"
                >
                  Start onboarding →
                </Link>
                <Link
                  href="/settings/github"
                  className="text-[12px] font-medium tracking-tight text-zinc-500 hover:text-[#1d1d1f] hover:underline"
                >
                  Or go to GitHub App settings
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div
        id="tour-overview-stats"
        className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
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
        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle>Recent audit events</CardTitle>
            <CardDescription>
              <Link href="/audit" className="font-medium text-[#0071e3] hover:underline">
                View full audit trail →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            {recentAuditEvents.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No audit events yet"
                  description="Important actions will appear here."
                />
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {recentAuditEvents.map((event) => (
                  <div
                    key={event.id}
                    className="group flex gap-3 px-6 py-3.5 transition-colors hover:bg-zinc-50/70"
                  >
                    <div className="flex flex-col items-center pt-1">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full bg-[#0071e3] shadow-[0_0_0_4px_rgba(0,113,227,0.12)]"
                      />
                      <span
                        aria-hidden="true"
                        className="mt-1.5 w-px flex-1 bg-zinc-200/80 group-last:hidden"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-400">
                        {formatDate(event.createdAt)}
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-medium text-[#1d1d1f]">
                        {event.action}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {event.actorType === ActorType.SYSTEM
                          ? "system"
                          : (event.actorId?.replace("user-", "") ?? "—")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>What you can do with this demo environment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
                className="group flex items-start gap-3 rounded-[16px] border border-zinc-200 bg-white px-3.5 py-3 transition-all hover:border-zinc-300 hover:bg-zinc-50/80 hover:shadow-sm"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-xs font-semibold text-white shadow-sm transition-colors group-hover:bg-[#0077ed]"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="block text-[13px] font-semibold tracking-tight text-[#1d1d1f]">
                      {step.title}
                    </span>
                    <span className="ml-auto hidden rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-zinc-500 shadow-sm group-hover:border-[#0071e3]/20 group-hover:text-[#0071e3] sm:inline-flex">
                      Open →
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-zinc-500">
                    {step.body}
                  </span>
                </span>
              </Link>
            ))}
            <p className="px-1 pb-1 pt-1 text-[12px] leading-relaxed text-zinc-500">
              Run the guided demo scenarios from the Demo page to see change detection, impact
              analysis, patch generation, validation, and draft PR creation end to end.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="text-[12px] text-zinc-500">
        Demo data seed:{" "}
        {truncate(
          "Acme SaaS · billing-service, ai-assistant-service, notification-service, auth-gateway",
          100,
        )}
      </p>
    </div>
  );
}
