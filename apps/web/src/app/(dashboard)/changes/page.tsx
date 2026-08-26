import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@patchbay/ui";
import { requireRole } from "@/lib/auth";
import { CHANGE_STATUS_TONE, formatDate, SEVERITY_TONE, SOURCE_TYPE_LABEL } from "@/lib/format";
import { Zap, AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Change events",
};

export default async function ChangesPage() {
  const user = await requireRole("VIEWER");

  const events = await prisma.vendorChangeEvent.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
    include: { vendor: true, normalizations: true },
    take: 100,
  });

  const breakingCount = events.filter((event) =>
    event.normalizations.some((n) => n.breaking),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Detected Change Events"
        description="Vendor API deprecations, breaking SDK changes, and release diffs ingested via Watchtower and GitHub feeds."
        badge={
          <Badge tone={breakingCount > 0 ? "red" : "neutral"} dot>
            {breakingCount} Breaking Detected
          </Badge>
        }
      />

      {events.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-red-500/30 bg-red-500/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
                Breaking Changes
              </span>
              <AlertTriangle className="size-4 text-red-400" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-red-400">{breakingCount}</p>
            <p className="mt-0.5 text-xs text-red-400/80">Requires AST analysis & remediation</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                Non-Breaking Releases
              </span>
              <ShieldCheck className="size-4 text-mint-400" />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-gray-200">
              {events.length - breakingCount}
            </p>
            <p className="mt-0.5 text-xs text-ink-400">Compatible additive modifications</p>
          </Card>
        </div>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          icon={<Zap className="size-6 text-accent-400" />}
          title="No vendor change events detected"
          description="Watchtower release polling and vendor webhook events will appear here."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Event Title</TableHeaderCell>
              <TableHeaderCell>Vendor</TableHeaderCell>
              <TableHeaderCell>Detection Source</TableHeaderCell>
              <TableHeaderCell>Severity</TableHeaderCell>
              <TableHeaderCell>Triage Status</TableHeaderCell>
              <TableHeaderCell>Detected Date</TableHeaderCell>
              <TableHeaderCell className="w-10"></TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id} className="group">
                <TableCell>
                  <Link
                    href={`/changes/${event.id}`}
                    className="font-semibold text-accent-400 hover:text-accent-300 hover:underline flex items-center gap-2"
                  >
                    <span>{event.title}</span>
                    {event.normalizations.some((n) => n.breaking) ? (
                      <Badge tone="red" size="sm" dot>
                        breaking
                      </Badge>
                    ) : null}
                  </Link>
                </TableCell>
                <TableCell className="text-xs font-medium text-gray-200">
                  {event.vendor.name}
                </TableCell>
                <TableCell className="text-xs text-ink-300 font-mono">
                  {SOURCE_TYPE_LABEL[event.sourceType]}
                </TableCell>
                <TableCell>
                  <Badge tone={SEVERITY_TONE[event.severity]} size="sm">
                    {event.severity}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StatusPill label={event.status} tone={CHANGE_STATUS_TONE[event.status]} />
                </TableCell>
                <TableCell className="text-xs text-ink-400">
                  {formatDate(event.detectedAt)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/changes/${event.id}`}
                    className="flex size-7 items-center justify-center rounded-lg text-ink-500 opacity-0 transition-all group-hover:opacity-100 group-hover:bg-ink-800 group-hover:text-accent-300"
                  >
                    <ArrowRight className="size-3.5" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
