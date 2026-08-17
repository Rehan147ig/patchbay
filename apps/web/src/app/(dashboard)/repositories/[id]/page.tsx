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
import { requireUser } from "@/lib/auth";
import { ScanRepositoryButton } from "@/components/scan-repository-button";
import {
  formatDate,
  formatDateOnly,
  RISK_TAG_LABEL,
  RISK_TAG_TONE,
  SCAN_STATUS_TONE,
} from "@/lib/format";
import type { RiskTag, UsageType } from "@patchbay/domain";

export const metadata: Metadata = {
  title: "Repository detail",
};

export default async function RepositoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const repository = await prisma.repository.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      scans: { orderBy: { createdAt: "desc" }, take: 5 },
      usages: {
        orderBy: [{ filePath: "asc" }, { symbol: "asc" }],
        include: { vendor: true },
      },
      impactAssessments: {
        include: { changeEvent: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!repository) notFound();

  const vendorsByUsage = new Map<string, { name: string; count: number }>();
  for (const usage of repository.usages) {
    const entry = vendorsByUsage.get(usage.vendor.slug) ?? { name: usage.vendor.name, count: 0 };
    entry.count += 1;
    vendorsByUsage.set(usage.vendor.slug, entry);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/repositories" className="text-blue-600 hover:underline">
            Repositories
          </Link>{" "}
          /
        </p>
        <h1 className="text-xl font-semibold text-slate-900">{repository.name}</h1>
        <p className="text-sm text-slate-500">
          {repository.fullName} · {repository.provider} · default branch {repository.defaultBranch}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {repository.usages.length} indexed usage
          {repository.usages.length === 1 ? "" : "s"} · last scan{" "}
          {repository.scans[0] ? formatDate(repository.scans[0].completedAt) : "never"}
        </p>
        <ScanRepositoryButton repositoryId={repository.id} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vendor dependencies</CardTitle>
            <CardDescription>Detected vendor SDK usage in this repository.</CardDescription>
          </CardHeader>
          <CardContent>
            {vendorsByUsage.size === 0 ? (
              <p className="text-sm text-slate-500">No vendor usages detected.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...vendorsByUsage.entries()].map(([slug, info]) => (
                  <li key={slug} className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-slate-800">{info.name}</span>
                    <Badge tone="neutral">{info.count} usages</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest scans</CardTitle>
            <CardDescription>Repository analysis history.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {repository.scans.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No scans yet.</p>
            ) : (
              <Table className="rounded-none border-0 shadow-none">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Completed</TableHeaderCell>
                    <TableHeaderCell>Usages</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {repository.scans.map((scan) => (
                    <TableRow key={scan.id}>
                      <TableCell>
                        <StatusPill label={scan.status} tone={SCAN_STATUS_TONE[scan.status]} />
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {formatDate(scan.completedAt)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {scan.summary &&
                        typeof scan.summary === "object" &&
                        "usageCount" in scan.summary
                          ? String(scan.summary.usageCount)
                          : "—"}
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
          <CardTitle>Usage inventory</CardTitle>
          <CardDescription>Indexed integration usages from the latest scan.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {repository.usages.length === 0 ? (
            <div className="px-4 py-3">
              <EmptyState
                title="No usages indexed"
                description="Run a scan to build the usage inventory."
              />
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>File</TableHeaderCell>
                  <TableHeaderCell>Symbol</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Owner</TableHeaderCell>
                  <TableHeaderCell>Risk tags</TableHeaderCell>
                  <TableHeaderCell>Excerpt</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {repository.usages.map((usage) => (
                  <TableRow key={usage.id}>
                    <TableCell className="font-mono text-xs">
                      {usage.filePath}
                      {usage.astLocation &&
                      typeof usage.astLocation === "object" &&
                      "line" in usage.astLocation ? (
                        <span className="text-slate-400">:{String(usage.astLocation.line)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{usage.symbol}</TableCell>
                    <TableCell className="text-xs">{usageTypeLabel(usage.usageType)}</TableCell>
                    <TableCell className="text-xs">{usage.ownerHint}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {(usage.riskTags as RiskTag[]).map((tag) => (
                          <Badge key={tag} tone={RISK_TAG_TONE[tag]}>
                            {RISK_TAG_LABEL[tag]}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs">
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

      <Card>
        <CardHeader>
          <CardTitle>Related impact assessments</CardTitle>
          <CardDescription>Change events assessed against this repository.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {repository.impactAssessments.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">
              No impact assessments yet. Assessments appear once change events are analyzed.
            </p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Change</TableHeaderCell>
                  <TableHeaderCell>Score</TableHeaderCell>
                  <TableHeaderCell>Confidence</TableHeaderCell>
                  <TableHeaderCell>Assessed</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {repository.impactAssessments.map((assessment) => (
                  <TableRow key={assessment.id}>
                    <TableCell>
                      <Link
                        href={`/changes/${assessment.changeEventId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {assessment.changeEvent.title}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{assessment.score}</TableCell>
                    <TableCell className="tabular-nums">{assessment.confidence}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDateOnly(assessment.createdAt)}
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

function usageTypeLabel(usageType: UsageType): string {
  const labels: Record<UsageType, string> = {
    IMPORT: "Import",
    INITIALIZATION: "Init",
    METHOD_CALL: "Method call",
    ENDPOINT_CALL: "Endpoint call",
    CONFIG: "Config",
    WEBHOOK: "Webhook",
    ENVIRONMENT_REFERENCE: "Env reference",
  };
  return labels[usageType];
}
