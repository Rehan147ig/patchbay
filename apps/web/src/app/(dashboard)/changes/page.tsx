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
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <PageHeader
        title="Detected Change Events"
        description="Vendor API deprecations, breaking SDK changes, and release diffs ingested via Watchtower and GitHub feeds."
        badge={
          <Badge tone={breakingCount > 0 ? "red" : "neutral"} variant="subtle" dot>
            {breakingCount} Breaking Detected
          </Badge>
        }
      />

      {events.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          <Card className="rounded-[20px] border-zinc-200 bg-white px-6 py-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                Breaking Changes
              </span>
              <span className="flex size-8 items-center justify-center rounded-xl bg-[#ff3b30]/10 text-[#ff3b30]">
                <AlertTriangle className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-[20px] font-semibold tracking-tight tabular-nums text-[#1d1d1f]">
              {breakingCount}
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">Requires AST analysis & remediation</p>
          </Card>
          <Card className="rounded-[20px] border-zinc-200 bg-white px-6 py-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                Non-Breaking Releases
              </span>
              <span className="flex size-8 items-center justify-center rounded-xl bg-[#34c759]/10 text-[#34c759]">
                <ShieldCheck className="size-4" />
              </span>
            </div>
            <p className="mt-3 text-[20px] font-semibold tracking-tight tabular-nums text-[#1d1d1f]">
              {events.length - breakingCount}
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">Compatible additive modifications</p>
          </Card>
        </div>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          icon={<Zap className="size-6 text-[#0071e3]" />}
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
                    className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-[#0071e3] hover:underline"
                  >
                    <span>{event.title}</span>
                    {event.normalizations.some((n) => n.breaking) ? (
                      <Badge tone="red" variant="subtle" size="sm" dot>
                        breaking
                      </Badge>
                    ) : null}
                  </Link>
                </TableCell>
                <TableCell className="text-xs font-medium tracking-tight text-[#1d1d1f]">
                  {event.vendor.name}
                </TableCell>
                <TableCell className="font-mono text-[12px] text-zinc-500">
                  {SOURCE_TYPE_LABEL[event.sourceType]}
                </TableCell>
                <TableCell>
                  <Badge tone={SEVERITY_TONE[event.severity]} variant="subtle" size="sm">
                    {event.severity}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StatusPill label={event.status} tone={CHANGE_STATUS_TONE[event.status]} />
                </TableCell>
                <TableCell className="text-[12px] text-zinc-500">
                  {formatDate(event.detectedAt)}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/changes/${event.id}`}
                    className="flex size-7 items-center justify-center rounded-full border border-transparent text-zinc-400 opacity-0 transition-all group-hover:opacity-100 group-hover:border-zinc-200 group-hover:bg-white group-hover:text-[#0071e3] group-hover:shadow-sm"
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
