import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@patchbay/db";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CodeBlock,
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
import { AnalyzeChangeButton } from "@/components/analyze-change-button";
import { GeneratePlanButton } from "@/components/generate-plan-button";
import {
  CHANGE_STATUS_TONE,
  CHANGE_TYPE_LABEL,
  formatDate,
  formatDateOnly,
  SEVERITY_TONE,
  SOURCE_TYPE_LABEL,
} from "@/lib/format";
import type { RiskLevel } from "@patchbay/domain";

export const metadata: Metadata = {
  title: "Change event",
};

export default async function ChangeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("VIEWER");
  const { id } = await params;

  const event = await prisma.vendorChangeEvent.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      vendor: true,
      normalizations: true,
      impactAssessments: {
        include: { repository: true, plans: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!event) notFound();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/changes" className="text-blue-600 hover:underline">
            Changes
          </Link>{" "}
          /
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">{event.title}</h1>
          <Badge tone="blue">{event.vendor.name}</Badge>
          <Badge tone={SEVERITY_TONE[event.severity]}>{event.severity}</Badge>
          <StatusPill label={event.status} tone={CHANGE_STATUS_TONE[event.status]} />
          <AnalyzeChangeButton changeEventId={event.id} />
          <GeneratePlanButton
            changeEventId={event.id}
            disabled={event.impactAssessments.length === 0}
          />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {SOURCE_TYPE_LABEL[event.sourceType]} · detected {formatDate(event.detectedAt)}
          {event.effectiveAt ? ` · effective ${formatDateOnly(event.effectiveAt)}` : ""}
          {event.sourceUrl ? (
            <>
              {" · "}
              <span className="break-all">{event.sourceUrl}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Normalized changes</CardTitle>
            <CardDescription>How Patchbay classified this event.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {event.normalizations.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No normalized changes yet.</p>
            ) : (
              <Table className="rounded-none border-0 shadow-none">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Old</TableHeaderCell>
                    <TableHeaderCell>New</TableHeaderCell>
                    <TableHeaderCell>Breaking</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {event.normalizations.map((normalization) => (
                    <TableRow key={normalization.id}>
                      <TableCell className="text-xs">
                        {CHANGE_TYPE_LABEL[normalization.changeType]}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {normalization.oldValue ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {normalization.newValue ?? "—"}
                      </TableCell>
                      <TableCell>
                        {normalization.breaking ? (
                          <Badge tone="red">breaking</Badge>
                        ) : (
                          <Badge tone="green">compatible</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Raw payload</CardTitle>
            <CardDescription>Source data attached to this event.</CardDescription>
          </CardHeader>
          <CardContent>
            {event.rawPayload ? (
              <CodeBlock maxHeight="16rem">{JSON.stringify(event.rawPayload, null, 2)}</CodeBlock>
            ) : (
              <p className="text-sm text-slate-500">No raw payload stored.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Impact assessments</CardTitle>
          <CardDescription>Repositories assessed against this change.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {event.impactAssessments.length === 0 ? (
            <div className="px-4 py-3">
              <EmptyState
                title="Not analyzed yet"
                description="Impact assessment runs after this change is analyzed against connected repositories."
              />
            </div>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Repository</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Impact</TableHeaderCell>
                  <TableHeaderCell>Confidence</TableHeaderCell>
                  <TableHeaderCell>Risk</TableHeaderCell>
                  <TableHeaderCell>Rationale</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {event.impactAssessments.map((assessment) => (
                  <TableRow key={assessment.id}>
                    <TableCell>
                      <Link
                        href={`/repositories/${assessment.repository.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {assessment.repository.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{assessment.status}</TableCell>
                    <TableCell className="tabular-nums">{assessment.score}</TableCell>
                    <TableCell className="tabular-nums">{assessment.confidence}</TableCell>
                    <TableCell>
                      <Badge tone={riskTone(assessment.riskLevel)}>{assessment.riskLevel}</Badge>
                    </TableCell>
                    <TableCell className="max-w-sm text-xs text-slate-500">
                      {assessment.rationale}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function riskTone(level: RiskLevel): "green" | "amber" | "red" {
  if (level === "LOW") return "green";
  if (level === "MEDIUM") return "amber";
  return "red";
}
