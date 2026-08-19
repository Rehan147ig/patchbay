import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import {
  ConnectRepositoryForm,
  type ConnectInstallation,
} from "@/components/connect-repository-form";

export const metadata: Metadata = {
  title: "Repositories",
};

export default async function RepositoriesPage() {
  const user = await requireUser();

  const [repositories, installations] = await Promise.all([
    prisma.repository.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
      include: {
        scans: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { usages: true } },
      },
    }),
    prisma.gitHubInstallation.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { installedAt: "desc" },
      select: { installationId: true, accountLogin: true, accountType: true },
    }),
  ]);

  const canConnect = user.role === "ADMIN" || user.role === "MEMBER";

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
          description="Connect a GitHub repository (or run the guided demo) to start monitoring usages."
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

      {canConnect ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect a GitHub repository</CardTitle>
            <CardDescription>
              Register a repository from a GitHub App installation, then scan it to index TypeScript
              and Python call sites.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {installations.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500">
                  No GitHub App installations for this workspace yet.
                </p>
                <Link
                  href="/settings/github"
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Install the GitHub App
                </Link>
              </div>
            ) : (
              <ConnectRepositoryForm installations={installations as ConnectInstallation[]} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
