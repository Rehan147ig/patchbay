import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, packageImpact } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusPill,
} from "@patchbay/ui";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Release detail",
};

const RELEASE_STATUS_TONE = {
  OBSERVED: "neutral",
  CLASSIFIED: "blue",
  FAILED: "red",
} as const;

interface ChangeDraftView {
  changeType: string;
  oldValue: string | null;
  newValue: string | null;
  description: string | null;
  breaking: boolean;
  rule: string | null;
}

export default async function ReleaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("VIEWER");
  const { id } = await params;

  const release = await prisma.releaseRecord.findUnique({
    where: { id },
    include: {
      product: { select: { packageName: true, vendor: { select: { slug: true, name: true } } } },
      classifications: true,
    },
  });
  if (!release) notFound();

  const matches = await prisma.releaseRepositoryMatch.findMany({
    where: { releaseRecordId: release.id, organizationId: user.organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      repository: { select: { id: true, name: true, fullName: true } },
      dependency: {
        select: { packageName: true, declaredRange: true, resolvedVersion: true, commitSha: true },
      },
    },
  });

  const evidence = [];
  for (const match of matches) {
    const impact = await packageImpact({
      organizationId: user.organizationId,
      repositoryId: match.repositoryId,
      packageName: release.product.packageName,
    });
    evidence.push({ match, impact });
  }

  const classification = release.classifications[0];
  const facts = classification?.factsJson;
  const drafts: ChangeDraftView[] =
    typeof facts === "object" &&
    facts !== null &&
    Array.isArray((facts as { changeDrafts?: unknown }).changeDrafts)
      ? (facts as unknown as { changeDrafts: ChangeDraftView[] }).changeDrafts
      : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {release.product.packageName} {release.version}
        </h1>
        <p className="text-sm text-slate-500">
          {release.product.vendor.name} · previous {release.previousVersion ?? "unknown"} · observed{" "}
          {formatDate(release.publishedAt)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Classification
            <StatusPill label={release.status} tone={RELEASE_STATUS_TONE[release.status]} />
            {classification ? <Badge tone="blue">{classification.method}</Badge> : null}
          </CardTitle>
          <CardDescription>
            Deterministic facts produced by the classify-release processor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!classification ? (
            <p className="text-sm text-slate-400">
              Not classified yet — the worker will process this shortly.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Confidence</p>
                  <p className="font-medium">{classification.confidence}/100</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Breaking</p>
                  <p className="font-medium">{drafts.some((d) => d.breaking) ? "Yes" : "No"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Human review</p>
                  <p className="font-medium">
                    {classification.requiresHumanReview ? "Required" : "Not required"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Change drafts</p>
                  <p className="font-medium">{drafts.length}</p>
                </div>
              </div>
              {drafts.length > 0 ? (
                <ul className="divide-y divide-slate-100 rounded border border-slate-200">
                  {drafts.map((draft, index) => (
                    <li key={index} className="px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge tone={draft.breaking ? "red" : "slate"}>{draft.changeType}</Badge>
                        {draft.rule ? (
                          <span className="text-xs text-slate-400">{draft.rule}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-slate-700">
                        {draft.description ?? draft.oldValue ?? projectDraft(draft)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Affected repositories</CardTitle>
          <CardDescription>
            Matched by resolved version or declared range against the repository dependency
            inventory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {evidence.length === 0 ? (
            <p className="text-sm text-slate-400">
              No connected repository resolves or declares this package version.
            </p>
          ) : (
            <ul className="space-y-3">
              {evidence.map(({ match, impact }) => (
                <li key={match.id} className="rounded border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/repositories/${match.repositoryId}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {match.repository.name}
                    </Link>
                    <span className="text-xs text-slate-400">{match.repository.fullName}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{match.matchReason}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Resolved {match.dependency.resolvedVersion} · declared{" "}
                    {match.dependency.declaredRange ?? "—"} · at{" "}
                    {match.dependency.commitSha.slice(0, 12)}
                  </p>
                  {impact ? (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-slate-600">
                        Why affected (graph evidence)
                      </p>
                      <ul className="mt-1 list-disc pl-4 text-xs text-slate-600">
                        {impact.modules.length === 0 ? (
                          <li>No usage modules in the latest graph snapshot</li>
                        ) : (
                          impact.modules.map((module) => (
                            <li key={module.filePath}>
                              {module.filePath} — {module.edgeKinds.join(", ")} (
                              {module.evidenceCount} evidence rows)
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function projectDraft(draft: ChangeDraftView): string {
  return `${draft.oldValue ?? ""} → ${draft.newValue ?? ""}`.trim();
}
