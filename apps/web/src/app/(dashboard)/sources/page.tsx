import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState } from "@patchbay/ui";
import { requireRole } from "@/lib/auth";
import { listContractSources } from "@/lib/contract-sources";
import { SourcesClient } from "@/components/sources-client";
import { DeniedState, ErrorState, LoadingSkeleton } from "@/components/data-states";

export const metadata: Metadata = {
  title: "Contract Sources",
};

export const dynamic = "force-dynamic";

async function SourcesBody({
  organizationId,
  isAdmin,
}: {
  organizationId: string;
  isAdmin: boolean;
}) {
  let sources;
  try {
    sources = await listContractSources(organizationId);
  } catch (error) {
    return (
      <ErrorState
        message="Could not load contract sources."
        code={error instanceof Error ? error.name : undefined}
      />
    );
  }
  if (sources.length === 0) {
    return (
      <EmptyState
        title="No contract sources yet"
        description="Register a private source below, or seed catalog vendors. Sources feed change detection: polling vendors produces the contract changes your cases remediate."
      />
    );
  }
  return <SourcesClient sources={sources} isAdmin={isAdmin} />;
}

export default async function SourcesPage() {
  let organizationId: string;
  let role: string;
  try {
    const user = await requireRole("VIEWER");
    organizationId = user.organizationId;
    role = user.role;
  } catch {
    return (
      <div className="space-y-4">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">
          Contract Sources
        </h1>
        <DeniedState />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">
          Contract Sources
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Provider connections: feed status, health, and on-demand sync. Stale sources render a Sync
          Now action — never an error.
        </p>
      </div>
      <Suspense fallback={<LoadingSkeleton rows={4} label="Loading contract sources" />}>
        <SourcesBody organizationId={organizationId} isAdmin={role === "ADMIN"} />
      </Suspense>
    </div>
  );
}
