import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@patchbay/ui";
import { CaseReasonCode, CaseStatus } from "@patchbay/domain";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Remediation cases",
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

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireRole("VIEWER");
  const { status: statusFilter } = await searchParams;
  const activeStatuses: CaseStatus[] = [
    "POLICY_ELIGIBLE",
    "PLANNING",
    "PATCH_PROPOSED",
    "VALIDATING",
    "APPROVAL_REQUIRED",
    "DRAFT_PR_CREATED",
  ];
  const filterActive = typeof statusFilter === "string" && statusFilter === "active";

  const [cases, counts] = await Promise.all([
    prisma.remediationCase.findMany({
      where: {
        organizationId: user.organizationId,
        ...(filterActive ? { status: { in: activeStatuses } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        reasonCode: true,
        capabilityLevel: true,
        blastRadius: true,
        updatedAt: true,
        release: {
          select: {
            id: true,
            version: true,
            product: { select: { packageName: true, vendor: { select: { slug: true } } } },
          },
        },
        repository: { select: { fullName: true } },
      },
    }),
    prisma.remediationCase.groupBy({
      by: ["status"],
      where: { organizationId: user.organizationId },
      _count: { _all: true },
    }),
  ]);

  const activeCount = counts
    .filter((row) => !["REJECTED", "CANCELLED", "MERGED", "CLOSED", "LEARNED"].includes(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);

  const severityOf = (blastRadius: unknown): string => {
    if (typeof blastRadius !== "object" || blastRadius === null) return "LOW";
    const severity = (blastRadius as { severity?: unknown }).severity;
    return typeof severity === "string" ? severity : "LOW";
  };
  const scoreOf = (blastRadius: unknown): number => {
    if (typeof blastRadius !== "object" || blastRadius === null) return 0;
    const score = (blastRadius as { score?: unknown }).score;
    return typeof score === "number" ? score : 0;
  };

  const severityBorder: Record<string, string> = {
    CRITICAL: "border-l-2 border-red-500",
    HIGH: "border-l-2 border-amber-500",
    MEDIUM: "border-l-2 border-accent-500",
    LOW: "border-l-2 border-ink-600",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Remediation cases</h1>
          <p className="mt-1 text-sm text-ink-400">
            One case per affected (release, repository, dependency). Cases that cannot be automated
            stay visible with their reason instead of disappearing.
          </p>
        </div>
        <Card className="w-36 shrink-0">
          <CardContent className="p-3">
            <p className="text-2xl font-bold tabular-nums text-white">{activeCount}</p>
            <p className="text-xs text-ink-400">active cases</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter pills (server-driven via searchParams) */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { label: "All", href: "/cases", active: !filterActive },
          { label: "Active only", href: "/cases?status=active", active: filterActive },
        ].map((pill) => (
          <Link
            key={pill.label}
            href={pill.href}
            aria-current={pill.active ? "true" : undefined}
            className={
              pill.active
                ? "rounded-full border border-accent-500/30 bg-accent-500/20 px-3 py-1 text-xs font-medium text-accent-400"
                : "rounded-full bg-ink-700 px-3 py-1 text-xs font-medium text-ink-300 transition-colors hover:bg-ink-600 hover:text-gray-100"
            }
          >
            {pill.label}
          </Link>
        ))}
        <Badge tone="blue">{cases.length} shown</Badge>
      </div>

      {cases.length === 0 ? (
        <EmptyState
          title="No remediation cases yet"
          description="Cases appear automatically when a detected release matches an affected repository."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Package</TableHeaderCell>
              <TableHeaderCell>Repository</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Reason</TableHeaderCell>
              <TableHeaderCell>Blast radius</TableHeaderCell>
              <TableHeaderCell>Capability</TableHeaderCell>
              <TableHeaderCell>Updated</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cases.map((remediationCase) => {
              const severity = severityOf(remediationCase.blastRadius);
              return (
                <TableRow
                  key={remediationCase.id}
                  className={"group " + (severityBorder[severity] ?? "border-l-2 border-ink-600")}
                >
                  <TableCell>
                    <Link
                      href={`/cases/${remediationCase.id}`}
                      className="group flex items-center gap-2 font-medium text-accent-400 hover:underline"
                    >
                      {remediationCase.release.product.packageName}
                    </Link>
                    <div className="text-xs text-ink-400">
                      {remediationCase.release.product.vendor.slug} v
                      {remediationCase.release.version}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-300">
                    {remediationCase.repository.fullName}
                  </TableCell>
                  <TableCell>
                    <StatusPill
                      label={remediationCase.status}
                      tone={STATUS_TONE[remediationCase.status] ?? "neutral"}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-ink-400">
                    {REASON_LABEL[remediationCase.reasonCode] ?? remediationCase.reasonCode}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        severity === "CRITICAL" ? "red" : severity === "HIGH" ? "amber" : "blue"
                      }
                    >
                      {severity} · {scoreOf(remediationCase.blastRadius)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-ink-400">
                    {remediationCase.capabilityLevel}
                  </TableCell>
                  <TableCell className="text-xs text-ink-400">
                    {formatDate(remediationCase.updatedAt)}
                  </TableCell>
                  <TableCell aria-hidden="true">
                    <span className="block opacity-0 transition-opacity group-hover:opacity-100">
                      →
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How cases work</CardTitle>
          <CardDescription>
            Policy-first funnel: evidence, certified capability and tenant policy are evaluated
            deterministically before any model budget is spent. Approved PRs are always drafts.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
