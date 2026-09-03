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
import { UntrackedPackages } from "@/components/untracked-packages";
import {
  formatDate,
  formatDateOnly,
  GRAPH_INDEX_STATUS_TONE,
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
      graphIndexJobs: { orderBy: { startedAt: "desc" }, take: 5 },
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

  const latestScanSummary = (() => {
    const summary = repository.scans[0]?.summary;
    if (typeof summary !== "object" || summary === null) return null;
    const packages = (summary as { untrackedPackages?: unknown }).untrackedPackages;
    return Array.isArray(packages)
      ? packages
          .filter((pkg): pkg is string => typeof pkg === "string" && pkg.length > 0)
          .slice(0, 20)
      : null;
  })();

  const vendorsByUsage = new Map<string, { name: string; count: number }>();
  for (const usage of repository.usages) {
    const entry = vendorsByUsage.get(usage.vendor.slug) ?? { name: usage.vendor.name, count: 0 };
    entry.count += 1;
    vendorsByUsage.set(usage.vendor.slug, entry);
  }

  const latestScan = repository.scans[0] ?? null;
  const affectedAssessments = repository.impactAssessments.filter(
    (assessment) => assessment.status === "AFFECTED",
  );
  const healthGrade =
    affectedAssessments.length === 0 ? "A" : affectedAssessments.length <= 2 ? "B" : "C";
  const healthTone =
    healthGrade === "A" ? "bg-emerald-500" : healthGrade === "B" ? "bg-amber-500" : "bg-[#ff3b30]";
  const healthLabel =
    healthGrade === "A"
      ? "No breaking changes pending"
      : healthGrade === "B"
        ? `${affectedAssessments.length} breaking change${affectedAssessments.length === 1 ? "" : "s"} pending review`
        : `${affectedAssessments.length} breaking changes need attention`;

  return (
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <div className="border-b border-zinc-200/60 pb-6">
        <p className="text-xs font-medium tracking-tight text-zinc-400">
          <Link
            href="/repositories"
            className="text-zinc-500 transition-colors hover:text-[#0071e3] hover:underline"
          >
            Repositories
          </Link>{" "}
          <span className="text-zinc-300">/</span>{" "}
          <span className="text-zinc-900">{repository.name}</span>
        </p>
        <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-[#1d1d1f] antialiased">
          {repository.name}
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          {repository.fullName} · {repository.provider} · default branch {repository.defaultBranch}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-zinc-500">
          {repository.usages.length} indexed usage
          {repository.usages.length === 1 ? "" : "s"} · last scan{" "}
          {repository.scans[0] ? formatDate(repository.scans[0].completedAt) : "never"}
        </p>
        <ScanRepositoryButton repositoryId={repository.id} />
      </div>

      {latestScan?.status === "COMPLETED" ? (
        <Card className="overflow-hidden rounded-[20px] border-zinc-200 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
          <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between lg:p-8">
            <div className="flex items-center gap-5">
              <span
                aria-hidden="true"
                className={`flex size-16 shrink-0 items-center justify-center rounded-[20px] text-[28px] font-semibold tracking-tight text-white ${healthTone}`}
              >
                {healthGrade}
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  Health &amp; blast-radius radar
                </p>
                <p className="mt-0.5 text-[15px] font-semibold tracking-tight text-[#1d1d1f]">
                  {healthLabel}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {[...vendorsByUsage.entries()].map(([slug, info]) => (
                    <Badge key={slug} tone="neutral" variant="subtle">
                      {slug} · {info.count}
                    </Badge>
                  ))}
                  {vendorsByUsage.size === 0 ? (
                    <span className="text-[12px] text-zinc-400">No SDK packages detected</span>
                  ) : null}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[12px] font-medium tracking-tight text-zinc-500">
                  <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  Patchbay 24/7 Watchtower is now monitoring {vendorsByUsage.size} package
                  {vendorsByUsage.size === 1 ? "" : "s"} on this repository
                </p>
              </div>
            </div>
            <div className="shrink-0">
              {affectedAssessments[0] ? (
                <Link
                  href={`/changes/${affectedAssessments[0].changeEventId}`}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-[#0071e3] px-6 text-[13px] font-medium tracking-tight text-white shadow-sm hover:bg-[#0077ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/20"
                >
                  View {affectedAssessments.length} automated fix
                  {affectedAssessments.length === 1 ? "" : "es"} →
                </Link>
              ) : (
                <Link
                  href="/releases"
                  className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-6 text-[13px] font-medium tracking-tight text-[#1d1d1f] shadow-sm hover:bg-zinc-50"
                >
                  Browse release watchtower
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle>Vendor dependencies</CardTitle>
            <CardDescription>Detected vendor SDK usage in this repository.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {latestScanSummary && latestScanSummary.length > 0 ? (
              <UntrackedPackages packages={latestScanSummary} isAdmin={user.role === "ADMIN"} />
            ) : null}
            {vendorsByUsage.size === 0 ? (
              <p className="text-sm text-zinc-500">No vendor usages detected.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {[...vendorsByUsage.entries()].map(([slug, info]) => (
                  <li key={slug} className="flex items-center justify-between py-2.5">
                    <span className="text-[13px] font-medium tracking-tight text-[#1d1d1f]">
                      {info.name}
                    </span>
                    <Badge tone="neutral" variant="subtle">
                      {info.count} usages
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle>Latest scans</CardTitle>
            <CardDescription>Repository analysis history.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {repository.scans.length === 0 ? (
              <p className="px-6 py-4 text-sm text-zinc-500">No scans yet.</p>
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
                        {scan.status === "FAILED" && scan.error ? (
                          <p className="mt-1 max-w-[32ch] text-[11px] leading-snug text-[#ff3b30]">
                            {scan.error.slice(0, 200)}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">
                        {formatDate(scan.completedAt)}
                      </TableCell>
                      <TableCell className="tabular-nums text-[13px] text-[#1d1d1f]">
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

      <Card className="rounded-[20px] border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle>Graph index</CardTitle>
          <CardDescription>
            Deterministic graph snapshots (TypeScript and Python files) built after scans.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {repository.graphIndexJobs.length === 0 ? (
            <p className="px-6 py-4 text-sm text-zinc-500">
              No graph snapshots yet — they are built automatically after each scan.
            </p>
          ) : (
            <Table className="rounded-none border-0 shadow-none">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Mode</TableHeaderCell>
                  <TableHeaderCell>Completed</TableHeaderCell>
                  <TableHeaderCell>Nodes</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {repository.graphIndexJobs.map((job) => {
                  const timings =
                    job.timingsJson && typeof job.timingsJson === "object" ? job.timingsJson : null;
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <StatusPill
                          label={job.status}
                          tone={GRAPH_INDEX_STATUS_TONE[job.status] ?? "neutral"}
                        />
                      </TableCell>
                      <TableCell className="text-xs font-medium text-zinc-600">
                        {job.mode}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500">
                        {formatDate(job.completedAt)}
                      </TableCell>
                      <TableCell className="tabular-nums text-[13px] text-[#1d1d1f]">
                        {timings && "nodeCount" in timings ? String(timings.nodeCount) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-[20px] border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle>Usage inventory</CardTitle>
          <CardDescription>Indexed integration usages from the latest scan.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {repository.usages.length === 0 ? (
            <div className="px-6 py-4">
              <EmptyState
                title="No certified SDK call sites found"
                description="Run a scan to index TypeScript and Python call sites. Repositories without vendor SDK usage stay empty."
              />
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>File</TableHeaderCell>
                  <TableHeaderCell>Package</TableHeaderCell>
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
                    <TableCell className="font-mono text-xs text-zinc-700">
                      {usage.filePath}
                      {usage.astLocation &&
                      typeof usage.astLocation === "object" &&
                      "line" in usage.astLocation ? (
                        <span className="text-zinc-400">:{String(usage.astLocation.line)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-600">
                      {usage.vendor.slug}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[#1d1d1f]">
                      {usage.symbol}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-600">
                      {usageTypeLabel(usage.usageType)}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">{usage.ownerHint}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {(usage.riskTags as RiskTag[]).map((tag) => (
                          <Badge key={tag} tone={RISK_TAG_TONE[tag]} variant="subtle" size="sm">
                            {RISK_TAG_LABEL[tag]}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <CodeBlock maxHeight="6rem" className="whitespace-pre-wrap break-all text-xs">
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

      <Card className="rounded-[20px] border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle>Related impact assessments</CardTitle>
          <CardDescription>Change events assessed against this repository.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {repository.impactAssessments.length === 0 ? (
            <p className="px-6 py-4 text-sm text-zinc-500">
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
                        className="text-[13px] font-medium text-[#0071e3] hover:underline"
                      >
                        {assessment.changeEvent.title}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm text-[#1d1d1f]">
                      {assessment.score}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm text-zinc-600">
                      {assessment.confidence}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500">
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
