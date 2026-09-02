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
  PageHeader,
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
import { GitBranch, Plus, ArrowRight } from "lucide-react";

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
    <div className="space-y-6 bg-[#fbfbfd] font-sans antialiased">
      <PageHeader
        title="Connected Repositories"
        description="Source code repositories monitored for upstream SDK breaking changes and integration callsite usages."
        badge={
          <Badge tone="blue" variant="subtle" dot>
            {repositories.length} Repositories
          </Badge>
        }
        actions={
          <Link
            href="/settings/github"
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-medium text-zinc-600 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-[#1d1d1f]"
          >
            <Plus className="size-3.5" />
            <span>Configure GitHub App</span>
          </Link>
        }
      />

      {repositories.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="size-6 text-[#0071e3]" />}
          title="No repositories connected yet"
          description="Connect a GitHub repository or use the demo setup to start indexing AST usages and monitoring releases."
          action={
            <Link
              href="/settings/github"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0071e3] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#0077ed]"
            >
              Install GitHub App
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Repository</TableHeaderCell>
              <TableHeaderCell>Provider</TableHeaderCell>
              <TableHeaderCell>Indexed Usages</TableHeaderCell>
              <TableHeaderCell>Latest Scan Status</TableHeaderCell>
              <TableHeaderCell>Registered Date</TableHeaderCell>
              <TableHeaderCell className="w-10"></TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {repositories.map((repository) => {
              const latestScan = repository.scans[0];
              return (
                <TableRow key={repository.id} className="group">
                  <TableCell>
                    <Link
                      href={`/repositories/${repository.id}`}
                      className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-[#0071e3] hover:underline"
                    >
                      <span>{repository.name}</span>
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-zinc-500">{repository.fullName}</p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={repository.provider === "GITHUB" ? "blue" : "neutral"}
                      size="sm"
                      variant="subtle"
                    >
                      {repository.provider}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-[13px] font-semibold text-[#1d1d1f]">
                    {repository._count.usages}{" "}
                    <span className="text-xs font-normal text-zinc-500">calls</span>
                  </TableCell>
                  <TableCell>
                    {latestScan ? (
                      <StatusPill
                        label={latestScan.status}
                        tone={SCAN_STATUS_TONE[latestScan.status]}
                      />
                    ) : (
                      <span className="text-xs text-zinc-500">Never scanned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">
                    {formatDate(repository.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/repositories/${repository.id}`}
                      className="flex size-7 items-center justify-center rounded-full border border-transparent text-zinc-400 opacity-0 transition-all group-hover:opacity-100 group-hover:border-zinc-200 group-hover:bg-white group-hover:text-[#0071e3] group-hover:shadow-sm"
                    >
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {canConnect ? (
        <Card className="rounded-[20px] border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle>Connect a GitHub repository</CardTitle>
            <CardDescription>
              Register a repository from an active GitHub App installation, then scan it to index
              TypeScript, Python, and Java call sites.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {installations.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 p-2">
                <p className="text-xs text-zinc-500">
                  No GitHub App installations found for this workspace.
                </p>
                <Link
                  href="/settings/github"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#0071e3] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#0077ed]"
                >
                  Install GitHub App
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
