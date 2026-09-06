import type { Metadata } from "next";
import { prisma } from "@patchbay/db";
import { autonomyTierSchema } from "@patchbay/domain";
import { requireRole } from "@/lib/auth";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export const metadata: Metadata = {
  title: "Set up Patch",
};

/**
 * Continuous-maintenance onboarding (WP12 §A): six steps from GitHub install
 * to organization policy. Every step loads real org data and every action
 * hits a real API — skippable steps simply defer to the matching dashboard
 * page, never to a dead end.
 */
export default async function OnboardingPage() {
  const user = await requireRole("MEMBER");
  const appConfigured = Boolean(process.env.GITHUB_APP_SLUG?.trim());
  const [installations, repositories, certifications, orgSources, firstCase, autonomyPolicy] =
    await Promise.all([
      prisma.gitHubInstallation.findMany({
        where: { organizationId: user.organizationId, suspendedAt: null },
        orderBy: { installedAt: "desc" },
        select: { installationId: true, accountLogin: true, accountType: true },
      }),
      prisma.repository.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "asc" },
        select: { id: true, fullName: true, status: true, defaultBranch: true },
      }),
      prisma.connectorCertification.findMany({
        where: { status: "CERTIFIED", capability: "DRAFT_PR" },
        select: { connectorSlug: true },
      }),
      prisma.contractSource.findMany({
        where: { organizationId: user.organizationId },
        select: { vendorSlug: true, kind: true },
      }),
      prisma.remediationCase.findFirst({
        // Closed funnels never open the onboarding preview.
        where: {
          organizationId: user.organizationId,
          status: { notIn: ["REJECTED", "CANCELLED", "MERGED", "CLOSED", "LEARNED"] },
        },
        orderBy: { updatedAt: "desc" },
        include: {
          repository: { select: { name: true } },
          release: {
            select: {
              version: true,
              product: { select: { packageName: true, vendor: { select: { slug: true } } } },
            },
          },
          impactAssessments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              affectedUsages: {
                take: 5,
                include: { usage: { select: { filePath: true, symbol: true, riskTags: true } } },
              },
            },
          },
        },
      }),
      prisma.autonomyPolicy.findUnique({
        where: { organizationId: user.organizationId },
        select: { defaultDecision: true },
      }),
    ]);

  const certifiedSlugs = Array.from(new Set(certifications.map((c) => c.connectorSlug))).sort();
  const vendors = await prisma.vendor.findMany({
    where: {
      slug: { in: certifiedSlugs },
      OR: [{ organizationId: null }, { organizationId: user.organizationId }],
    },
    select: { slug: true, name: true },
  });
  const vendorNames = new Map(vendors.map((v) => [v.slug, v.name]));
  const tier = autonomyTierSchema.safeParse(autonomyPolicy?.defaultDecision);

  return (
    <div className="mx-auto mt-6 w-full max-w-3xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Set up continuous maintenance
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Six steps from install to your first governed draft PR: connect the fleet, watch contract
          sources, run a read-only shadow scan, preview the first case, and choose the organization
          autonomy tier. Every step is skippable — deferred steps live on in the dashboard pages
          they point to.
        </p>
      </div>
      <OnboardingWizard
        appConfigured={appConfigured}
        installations={installations}
        repositories={repositories.map((r) => ({ ...r, status: r.status as string }))}
        catalogVendors={certifiedSlugs.map((slug) => ({
          slug,
          name: vendorNames.get(slug) ?? slug,
          watched: orgSources.some((s) => s.vendorSlug === slug),
        }))}
        firstCase={
          firstCase
            ? {
                id: firstCase.id,
                status: firstCase.status,
                repositoryName: firstCase.repository.name,
                releaseVersion: firstCase.release?.version ?? null,
                packageName: firstCase.release?.product.packageName ?? null,
                vendorSlug: firstCase.release?.product.vendor.slug ?? null,
                usages: (firstCase.impactAssessments[0]?.affectedUsages ?? []).map(
                  (a: { usage: { filePath: string; symbol: string; riskTags: unknown } }) => ({
                    filePath: a.usage.filePath,
                    symbol: a.usage.symbol,
                    riskTags: a.usage.riskTags as string[],
                  }),
                ),
              }
            : null
        }
        currentTier={tier.success ? tier.data : null}
        isAdmin={user.role === "ADMIN"}
      />
    </div>
  );
}
