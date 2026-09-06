import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@patchbay/ui";
import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { OperationsClient, type DeadLetterRow } from "@/components/operations-client";
import { DeniedState, ErrorState, LoadingSkeleton } from "@/components/data-states";

export const metadata: Metadata = {
  title: "Operations",
};

export const dynamic = "force-dynamic";

async function CapabilitiesBody({ organizationId }: { organizationId: string }) {
  let gates;
  let certifications;
  try {
    [gates, certifications] = await Promise.all([
      prisma.capabilityGate.findMany({
        where: { organizationId },
        orderBy: [{ vendorSlug: "asc" }, { level: "asc" }],
      }),
      prisma.connectorCertification.findMany({
        where: { status: "CERTIFIED" },
        orderBy: [{ connectorSlug: "asc" }, { capability: "asc" }],
      }),
    ]);
  } catch (error) {
    return (
      <ErrorState
        message="Could not load capability gates."
        code={error instanceof Error ? error.name : undefined}
      />
    );
  }
  if (gates.length === 0) {
    return (
      <EmptyState
        title="No capability evaluations yet"
        description="Gates appear here once the health sweep evaluates a vendor capability — or after the first validation or draft PR creates one. Suspended gates block their routes until an admin restores them."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {gates.map((gate) => {
        const cert = certifications.find(
          (c) => c.connectorSlug === gate.vendorSlug && c.capability === gate.level,
        );
        return (
          <li
            key={gate.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3"
          >
            <p className="min-w-0 flex-1 text-[13px] font-semibold text-zinc-900">
              {gate.vendorSlug} · {gate.level}
            </p>
            <span
              className={
                gate.status === "SUSPENDED"
                  ? "rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-medium text-red-800"
                  : "rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800"
              }
            >
              {gate.status}
            </span>
            <span className="text-[11px] text-zinc-500">
              {gate.consecutiveBreaches} consecutive breaches ·{" "}
              {cert ? `certified (${cert.version})` : "uncertified"}
            </span>
            {gate.reason ? (
              <p className="w-full truncate text-[12px] text-zinc-600">{gate.reason}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

async function DeadLettersBody({
  organizationId,
  isAdmin,
}: {
  organizationId: string;
  isAdmin: boolean;
}) {
  let rows;
  try {
    rows = await prisma.deadLetterJob.findMany({
      where: { organizationId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  } catch (error) {
    return (
      <ErrorState
        message="Could not load dead letters."
        code={error instanceof Error ? error.name : undefined}
      />
    );
  }
  const shaped: DeadLetterRow[] = rows.map((row) => ({
    id: row.id,
    jobType: row.jobType,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attemptsMade: row.attemptsMade,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
    // Scrubbed at write; truncated for display. Never raw secrets.
    payloadPreview: JSON.stringify(row.payload ?? {}).slice(0, 500),
  }));
  return <OperationsClient deadLetters={shaped} isAdmin={isAdmin} />;
}

export default async function OperationsPage() {
  let organizationId: string;
  let role: string;
  try {
    const user = await requireRole("VIEWER");
    organizationId = user.organizationId;
    role = user.role;
  } catch {
    return (
      <div className="space-y-4">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">Operations</h1>
        <DeniedState />
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">Operations</h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Fleet reliability: queue depth, dead letters with authorized replay, and capability health
          with breach counts.
        </p>
      </div>
      <Suspense fallback={<LoadingSkeleton rows={2} label="Loading fleet telemetry" />}>
        <DeadLettersBody organizationId={organizationId} isAdmin={role === "ADMIN"} />
      </Suspense>
      <section aria-label="Capability gates">
        <h2 className="mb-2 text-[15px] font-semibold text-zinc-900">Capability gates</h2>
        <Suspense fallback={<LoadingSkeleton rows={3} label="Loading capability gates" />}>
          <CapabilitiesBody organizationId={organizationId} />
        </Suspense>
      </section>
    </div>
  );
}
