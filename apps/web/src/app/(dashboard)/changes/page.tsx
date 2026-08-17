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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Change events</h1>
        <p className="text-sm text-slate-500">
          Vendor API/SDK changes detected for your monitored vendors.
        </p>
      </div>

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
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {event.title}
                  </Link>
                  {event.normalizations.some((n) => n.breaking) ? (
                    <Badge tone="red" className="ml-2">
                      breaking
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">{event.vendor.name}</TableCell>
                <TableCell className="text-xs">{SOURCE_TYPE_LABEL[event.sourceType]}</TableCell>
                <TableCell>
                  <Badge tone={SEVERITY_TONE[event.severity]}>{event.severity}</Badge>
                </TableCell>
                <TableCell>
                  <StatusPill label={event.status} tone={CHANGE_STATUS_TONE[event.status]} />
                </TableCell>
                <TableCell className="text-xs text-slate-500">
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
