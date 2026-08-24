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
import { CHANGE_STATUS_TONE, formatDate, SEVERITY_TONE, SOURCE_TYPE_LABEL } from "@/lib/format";

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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Change events</h1>
        <p className="mt-1 text-sm text-ink-400">
          Vendor API/SDK changes detected for your monitored vendors.
        </p>
      </div>

      {events.length > 0 ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-2xl font-bold tabular-nums text-red-400">{breakingCount}</p>
            <p className="text-xs text-red-400/70">Breaking changes</p>
          </div>
          <div className="rounded-xl border border-ink-700 bg-ink-800/50 p-4">
            <p className="text-2xl font-bold tabular-nums text-gray-300">
              {events.length - breakingCount}
            </p>
            <p className="text-xs text-ink-400">Non-breaking</p>
          </div>
        </div>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          title="No change events"
          description="Detected vendor changes will appear here."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Event</TableHeaderCell>
              <TableHeaderCell>Vendor</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Severity</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Detected</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <Link
                    href={`/changes/${event.id}`}
                    className="font-medium text-accent-400 hover:underline"
                  >
                    {event.title}
                  </Link>
                  {event.normalizations.some((n) => n.breaking) ? (
                    <Badge tone="red" className="ml-2">
                      breaking
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs text-gray-300">{event.vendor.name}</TableCell>
                <TableCell className="text-xs text-gray-300">
                  {SOURCE_TYPE_LABEL[event.sourceType]}
                </TableCell>
                <TableCell>
                  <Badge tone={SEVERITY_TONE[event.severity]}>{event.severity}</Badge>
                </TableCell>
                <TableCell>
                  <StatusPill label={event.status} tone={CHANGE_STATUS_TONE[event.status]} />
                </TableCell>
                <TableCell className="text-xs text-ink-400">
                  {formatDate(event.detectedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
