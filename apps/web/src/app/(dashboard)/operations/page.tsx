import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@patchbay/ui";
import Link from "next/link";
import { prisma } from "@patchbay/db";
import { requireRole } from "@/lib/auth";
import { OperationsClient, type DeadLetterRow } from "@/components/operations-client";
import { CapabilityGateControl } from "@/components/capability-gate-control";
import { DeniedState, ErrorState, LoadingSkeleton } from "@/components/data-states";

export const metadata: Metadata = {
  title: "Operations",
};

export const dynamic = "force-dynamic";

async function CapabilitiesBody({
  organizationId,
  isAdmin,
}: {
  organizationId: string;
  isAdmin: boolean;
}) {
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
            className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-zinc-900">
                {gate.vendorSlug} · {gate.level}
              </p>
              <p className="text-[11px] text-zinc-500">
                {gate.consecutiveBreaches} consecutive breaches ·{" "}
                {cert ? `certified (${cert.version})` : "uncertified"} · {gate.status}
              </p>
              {gate.reason ? (
                <p className="mt-1 truncate text-[12px] text-zinc-600">{gate.reason}</p>
              ) : null}
            </div>
            <CapabilityGateControl
              gate={{
                vendorSlug: gate.vendorSlug,
                vendorName: gate.vendorSlug,
                level: gate.level,
                status: gate.status as "ACTIVE" | "SUSPENDED",
                reason: gate.reason,
              }}
              isAdmin={isAdmin}
            />
          </li>
        );
      })}
    </ul>
  );
}

async function FreshnessBody({ organizationId }: { organizationId: string }) {
  let sources;
  let recentFailures;
  try {
    [sources, recentFailures] = await Promise.all([
      prisma.contractSource.findMany({
        where: { OR: [{ organizationId: null }, { organizationId }] },
        orderBy: { lastObservedAt: "desc" },
        take: 20,
        select: { vendorSlug: true, kind: true, name: true, lastObservedAt: true, status: true },
      }),
      prisma.deadLetterJob.count({
        where: { organizationId, errorCode: "GITHUB_RATE_LIMITED", status: "OPEN" },
      }),
    ]);
  } catch (error) {
    return (
      <ErrorState
        message="Could not load freshness."
        code={error instanceof Error ? error.name : undefined}
      />
    );
  }
  const stale = sources.filter(
    (s) =>
      !s.lastObservedAt || Date.now() - new Date(s.lastObservedAt).getTime() > 24 * 60 * 60 * 1000,
  ).length;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <p className="text-[13px] font-medium text-zinc-900">
        {sources.length} sources · {stale} stale &gt;24h · {recentFailures} rate-limited dead
        letters
      </p>
      <ul className="mt-2 space-y-1">
        {sources.slice(0, 8).map((s) => (
          <li
            key={`${s.vendorSlug}-${s.kind}-${s.name}`}
            className="flex justify-between text-[11px] text-zinc-600"
          >
            <span>
              {s.vendorSlug}/{s.kind}/{s.name}
            </span>
            <span className={s.lastObservedAt ? "text-emerald-600" : "text-amber-600"}>
              {s.lastObservedAt ? new Date(s.lastObservedAt).toLocaleString() : "never observed"}
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/sources"
        className="mt-2 inline-block text-[12px] font-medium text-[#0071e3] hover:underline"
      >
        Manage sources →
      </Link>
    </div>
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
      <section aria-label="Connector freshness and rate limits">
        <h2 className="mb-2 text-[15px] font-semibold text-zinc-900">
          Connector freshness & rate limits
        </h2>
        <Suspense fallback={<LoadingSkeleton rows={2} label="Loading freshness" />}>
          <FreshnessBody organizationId={organizationId} />
        </Suspense>
      </section>
      <section aria-label="Capability gates and kill switch">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-[15px] font-semibold text-zinc-900">
            Capability gates · kill switch
          </h2>
          <Link href="/audit" className="text-[12px] font-medium text-[#0071e3] hover:underline">
            Audit evidence →
          </Link>
        </div>
        <p className="mb-2 text-[12px] text-zinc-500">
          Suspended gates block PR/validation enqueue until restored. Admin toggle below is the kill
          switch.
        </p>
        <Suspense fallback={<LoadingSkeleton rows={3} label="Loading capability gates" />}>
          <CapabilitiesBody organizationId={organizationId} isAdmin={role === "ADMIN"} />
        </Suspense>
      </section>
    </div>
  );
}
