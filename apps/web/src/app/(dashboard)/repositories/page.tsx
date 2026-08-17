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
import { requireUser } from "@/lib/auth";
import { formatDate, SCAN_STATUS_TONE } from "@/lib/format";

export const metadata: Metadata = {
  title: "Repositories",
};

export default async function RepositoriesPage() {
  const user = await requireUser();

  const repositories = await prisma.repository.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
    include: {
      scans: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { usages: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Repositories</h1>
        <p className="text-sm text-slate-500">
          Connected repositories and their integration usage inventory.
        </p>
      </div>

      {repositories.length === 0 ? (
        <EmptyState
          title="No repositories connected"
          description="Register a repository to begin monitoring."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Repository</TableHeaderCell>
              <TableHeaderCell>Provider</TableHeaderCell>
              <TableHeaderCell>Usages</TableHeaderCell>
              <TableHeaderCell>Latest scan</TableHeaderCell>
              <TableHeaderCell>Registered</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {repositories.map((repository) => {
              const latestScan = repository.scans[0];
              return (
                <TableRow key={repository.id}>
                  <TableCell>
                    <Link
                      href={`/repositories/${repository.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {repository.name}
                    </Link>
                    <p className="text-xs text-slate-500">{repository.fullName}</p>
                  </TableCell>
                  <TableCell>
                    <Badge tone={repository.provider === "GITHUB" ? "blue" : "neutral"}>
                      {repository.provider}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{repository._count.usages}</TableCell>
                  <TableCell>
                    {latestScan ? (
                      <StatusPill
                        label={latestScan.status}
                        tone={SCAN_STATUS_TONE[latestScan.status]}
                      />
                    ) : (
                      <span className="text-xs text-slate-400">Never scanned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(repository.createdAt)}
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
