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
import { CaseReasonCode } from "@patchbay/domain";
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

export default async function CasesPage() {
  const user = await requireRole("VIEWER");

  const [cases, counts] = await Promise.all([
    prisma.remediationCase.findMany({
      where: { organizationId: user.organizationId },
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Remediation cases</h1>
          <p className="text-sm text-slate-500">
            One case per affected (release, repository, dependency). Cases that cannot be automated
            stay visible with their reason instead of disappearing.
          </p>
        </div>
        <Card className="w-40">
          <CardContent className="p-3">
            <p className="text-2xl font-bold text-slate-900">{activeCount}</p>
            <p className="text-xs text-slate-500">active cases</p>
          </CardContent>
        </Card>
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
            {cases.map((remediationCase) => (
              <TableRow key={remediationCase.id}>
                <TableCell>
                  <Link
                    href={`/cases/${remediationCase.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {remediationCase.release.product.packageName}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {remediationCase.release.product.vendor.slug} v{remediationCase.release.version}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{remediationCase.repository.fullName}</TableCell>
                <TableCell>
                  <StatusPill
                    label={remediationCase.status}
                    tone={STATUS_TONE[remediationCase.status] ?? "neutral"}
                  />
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {REASON_LABEL[remediationCase.reasonCode] ?? remediationCase.reasonCode}
                </TableCell>
                <TableCell>
                  <Badge
                    tone={
                      severityOf(remediationCase.blastRadius) === "CRITICAL"
                        ? "red"
                        : severityOf(remediationCase.blastRadius) === "HIGH"
                          ? "amber"
                          : "blue"
                    }
                  >
                    {severityOf(remediationCase.blastRadius)} ·{" "}
                    {scoreOf(remediationCase.blastRadius)}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {remediationCase.capabilityLevel}
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {formatDate(remediationCase.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
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
