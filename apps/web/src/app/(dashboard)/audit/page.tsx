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
    <div className="space-y-6">
      <PageHeader
        title="Immutable Audit Log"
        description="WORM-compliant append-only ledger tracking all policy evaluations, repository scans, agent runs, and user actions. Secrets are cryptographically redacted before storage."
        badge={
          <Badge tone="blue" dot>
            {events.length} Entries Recorded
          </Badge>
        }
      />

      {events.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-6 text-accent-400" />}
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
                <TableCell className="whitespace-nowrap text-xs text-ink-400 font-mono">
                  {formatDate(event.createdAt)}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs font-semibold text-gray-200 bg-ink-800/80 px-2 py-0.5 rounded border border-ink-700">
                    {event.action}
                  </span>
                </TableCell>
                <TableCell className="text-xs">
                  {event.actorType === ActorType.SYSTEM ? (
                    <Badge tone="slate" size="sm">
                      system
                    </Badge>
                  ) : event.actorType === ActorType.AGENT ? (
                    <Badge tone="purple" size="sm" dot>
                      agent
                    </Badge>
                  ) : (
                    <span className="font-mono text-gray-300 font-medium">
                      {event.actorId?.replace("user-", "") ?? "—"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-ink-400">
                  <span className="text-gray-300">{event.entityType}</span>
                  <span className="text-ink-600">:</span>
                  <span>{event.entityId ?? "—"}</span>
                </TableCell>
                <TableCell className="font-mono text-xs text-ink-500 truncate max-w-[120px]">
                  {event.correlationId ?? "—"}
                </TableCell>
                <TableCell className="max-w-xs">
                  <details className="text-xs group">
                    <summary className="cursor-pointer font-semibold text-accent-400 transition-colors hover:text-accent-300 flex items-center gap-1">
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
