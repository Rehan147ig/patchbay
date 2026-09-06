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
        contractChange: {
          select: { identity: true, source: { select: { vendorSlug: true } } },
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

  return (
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-200/60 pb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f] antialiased">
            Remediation cases
          </h1>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
            One case per affected (release, repository, dependency). Cases that cannot be automated
            stay visible with their reason instead of disappearing.
          </p>
        </div>
        <Card className="w-36 shrink-0 rounded-[16px] border-zinc-200 bg-white px-0 py-0">
          <CardContent className="p-4 text-center">
            <p className="text-[20px] font-semibold tracking-tight tabular-nums text-[#1d1d1f]">
              {activeCount}
            </p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-widest text-zinc-500">
              active cases
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter pills (server-driven via searchParams) — Apple rounded-full pills */}
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
                ? "inline-flex items-center rounded-full bg-[#0071e3] px-4 py-1.5 text-[13px] font-medium tracking-tight text-white shadow-sm transition-colors hover:bg-[#0077ed]"
                : "inline-flex items-center rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-[13px] font-medium tracking-tight text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-[#1d1d1f]"
            }
          >
            {pill.label}
          </Link>
        ))}
        <Badge tone="blue" variant="subtle">
          {cases.length} shown
        </Badge>
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
              <TableHeaderCell aria-hidden="true" className="w-10"></TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cases.map((remediationCase) => {
              const severity = severityOf(remediationCase.blastRadius);
              return (
                <TableRow key={remediationCase.id} className="group">
                  <TableCell>
                    <Link
                      href={`/cases/${remediationCase.id}`}
                      className="group/link flex items-center gap-2 text-[13px] font-semibold tracking-tight text-[#0071e3] hover:underline"
                    >
                      {remediationCase.release?.product.packageName ??
                        remediationCase.contractChange?.source.vendorSlug ??
                        "Contract case"}
                    </Link>
                    <div className="mt-0.5 text-[11px] font-medium tracking-wide text-zinc-500">
                      {remediationCase.release
                        ? `${remediationCase.release.product.vendor.slug} v${remediationCase.release.version}`
                        : (remediationCase.contractChange?.identity ?? "")}
                    </div>
                  </TableCell>
                  <TableCell className="text-[13px] font-medium tracking-tight text-[#1d1d1f]">
                    {remediationCase.repository.fullName}
                  </TableCell>
                  <TableCell>
                    <StatusPill
                      label={remediationCase.status}
                      tone={STATUS_TONE[remediationCase.status] ?? "neutral"}
                    />
                  </TableCell>
                  <TableCell className="text-[12px] text-zinc-500">
                    {REASON_LABEL[remediationCase.reasonCode] ?? remediationCase.reasonCode}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        severity === "CRITICAL" ? "red" : severity === "HIGH" ? "amber" : "blue"
                      }
                      variant="subtle"
                    >
                      {severity} · {scoreOf(remediationCase.blastRadius)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[12px] font-medium text-zinc-500">
                    {remediationCase.capabilityLevel}
                  </TableCell>
                  <TableCell className="text-[12px] text-zinc-500">
                    {formatDate(remediationCase.updatedAt)}
                  </TableCell>
                  <TableCell aria-hidden="true">
                    <span className="flex size-7 items-center justify-center rounded-full border border-transparent text-zinc-400 opacity-0 transition-all group-hover:opacity-100 group-hover:border-zinc-200 group-hover:bg-white group-hover:text-[#0071e3] group-hover:shadow-sm">
                      →
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Card className="rounded-[20px] border-zinc-200 bg-white">
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
