import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
  Badge,
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
import { formatDate } from "@/lib/format";
import { RecordReleaseForm } from "@/components/record-release-form";

export const metadata: Metadata = {
  title: "Releases",
};

const RELEASE_STATUS_TONE = {
  OBSERVED: "neutral",
  CLASSIFIED: "blue",
  FAILED: "red",
} as const;

export default async function ReleasesPage() {
  const user = await requireRole("VIEWER");

  const [releases, matchCounts] = await Promise.all([
    prisma.releaseRecord.findMany({
      orderBy: { publishedAt: "desc" },
      take: 50,
      include: {
        product: { select: { packageName: true, vendor: { select: { slug: true } } } },
        classifications: true,
      },
    }),
    prisma.releaseRepositoryMatch.groupBy({
      by: ["releaseRecordId"],
      where: { organizationId: user.organizationId },
      _count: { _all: true },
    }),
  ]);
  const countByRelease = new Map(matchCounts.map((row) => [row.releaseRecordId, row._count._all]));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Releases</h1>
          <p className="text-sm text-slate-500">
            Observed upstream releases, deterministic classification, and affected repositories.
          </p>
        </div>
        <RecordReleaseForm />
      </div>

      {releases.length === 0 ? (
        <EmptyState
          title="No releases observed"
          description="Record an upstream release to classify it and match affected repositories."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Package</TableHeaderCell>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Previous</TableHeaderCell>
              <TableHeaderCell>Classification</TableHeaderCell>
              <TableHeaderCell>Affected repositories</TableHeaderCell>
              <TableHeaderCell>Observed</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {releases.map((release) => {
              const classification = release.classifications[0];
              const breaking =
                classification?.factsJson !== null &&
                typeof classification?.factsJson === "object" &&
                classification.factsJson !== null
                  ? ((classification.factsJson as { breaking?: boolean }).breaking ?? null)
                  : null;
              return (
                <TableRow key={release.id}>
                  <TableCell>
                    <Link
                      href={`/releases/${release.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {release.product.packageName}
                    </Link>
                    <p className="text-xs text-slate-500">{release.product.vendor.slug}</p>
                  </TableCell>
                  <TableCell className="tabular-nums">{release.version}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {release.previousVersion ?? "—"}
                  </TableCell>
                  <TableCell>
                    {classification ? (
                      <div className="flex items-center gap-2">
                        <StatusPill
                          label={release.status}
                          tone={RELEASE_STATUS_TONE[release.status]}
                        />
                        {breaking !== null && breaking ? <Badge tone="red">breaking</Badge> : null}
                        {classification.requiresHumanReview ? (
                          <Badge tone="amber">review</Badge>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Unclassified</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {countByRelease.get(release.id) ?? 0}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(release.publishedAt)}
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
