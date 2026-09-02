import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import {
  Badge,
  CodeBlock,
  EmptyState,
  PageHeader,
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
import { FileText, ChevronDown } from "lucide-react";

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
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <PageHeader
        title="Immutable Audit Log"
        description="WORM-compliant append-only ledger tracking all policy evaluations, repository scans, agent runs, and user actions. Secrets are cryptographically redacted before storage."
        badge={
          <Badge tone="blue" variant="subtle" dot>
            {events.length} Entries Recorded
          </Badge>
        }
      />

      {events.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6 text-[#0071e3]" />}
          title="No audit events recorded"
          description="Workspace events and governed actions will appear in this immutable trail."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Timestamp</TableHeaderCell>
              <TableHeaderCell>Action Code</TableHeaderCell>
              <TableHeaderCell>Actor</TableHeaderCell>
              <TableHeaderCell>Target Entity</TableHeaderCell>
              <TableHeaderCell>Correlation ID</TableHeaderCell>
              <TableHeaderCell>Payload Delta</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id} className="group">
                <TableCell className="whitespace-nowrap font-mono text-xs text-zinc-500">
                  {formatDate(event.createdAt)}
                </TableCell>
                <TableCell>
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight text-[#1d1d1f]">
                    {event.action}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {event.actorType === ActorType.SYSTEM ? (
                    <Badge tone="neutral" variant="subtle" size="sm">
                      system
                    </Badge>
                  ) : event.actorType === ActorType.AGENT ? (
                    <Badge tone="purple" variant="subtle" size="sm" dot>
                      agent
                    </Badge>
                  ) : (
                    <span className="font-mono text-xs font-medium text-[#1d1d1f]">
                      {event.actorId?.replace("user-", "") ?? "—"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-zinc-500">
                  <span className="font-medium text-[#1d1d1f]">{event.entityType}</span>
                  <span className="text-zinc-300">:</span>
                  <span>{event.entityId ?? "—"}</span>
                </TableCell>
                <TableCell className="max-w-[140px] truncate font-mono text-xs text-zinc-400">
                  {event.correlationId ?? "—"}
                </TableCell>
                <TableCell className="max-w-xs">
                  <details className="group text-xs">
                    <summary className="flex cursor-pointer items-center gap-1 font-semibold text-[#0071e3] transition-colors hover:text-[#0077ed]">
                      <span>View payload</span>
                      <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-2">
                      <CodeBlock maxHeight="12rem">
                        {JSON.stringify(
                          {
                            before: event.beforeJson,
                            after: event.afterJson,
                            metadata: event.metadata,
                          },
                          null,
                          2,
                        )}
                      </CodeBlock>
                    </div>
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
