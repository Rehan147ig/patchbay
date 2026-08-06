import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@patchbay/ui";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { ActorType } from "@patchbay/domain";

export const metadata: Metadata = {
  title: "Audit trail",
};

export default async function AuditPage() {
  const user = await requireUser();

  const events = await prisma.auditEvent.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Audit trail</h1>
        <p className="text-sm text-slate-500">
          Append-only record of important actions. Secrets are redacted before storage.
        </p>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="No audit events"
          description="Actions performed in this workspace will be recorded here."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>When</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
              <TableHeaderCell>Actor</TableHeaderCell>
              <TableHeaderCell>Entity</TableHeaderCell>
              <TableHeaderCell>Correlation ID</TableHeaderCell>
              <TableHeaderCell>Details</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                  {formatDate(event.createdAt)}
                </TableCell>
                <TableCell className="font-mono text-xs">{event.action}</TableCell>
                <TableCell className="text-xs">
                  {event.actorType === ActorType.SYSTEM ? (
                    <Badge tone="slate">system</Badge>
                  ) : event.actorType === ActorType.AGENT ? (
                    <Badge tone="purple">agent</Badge>
                  ) : (
                    <span>{event.actorId?.replace("user-", "") ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {event.entityType}:{event.entityId ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-400">
                  {event.correlationId ?? "—"}
                </TableCell>
                <TableCell className="max-w-xs">
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-600">payload</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
                      {JSON.stringify(
                        {
                          before: event.beforeJson,
                          after: event.afterJson,
                          metadata: event.metadata,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
