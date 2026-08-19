import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, Severity, VendorChangeSource, logger } from "@patchbay/domain";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

const VENDOR_NPM_PACKAGES: Record<string, string> = {
  stripe: "stripe",
  openai: "openai",
  twilio: "twilio",
  auth0: "auth0",
  anthropic: "@anthropic-ai/sdk",
  "aws-sdk": "aws-sdk",
  supabase: "@supabase/supabase-js",
};

export const PollNpmRegistryJobDataSchema = z.object({
  vendorSlug: z.string().min(1),
  correlationId: z.string().min(1),
});
export type PollNpmRegistryJobData = z.infer<typeof PollNpmRegistryJobDataSchema>;

export async function processPollNpmRegistry(job: Job): Promise<void> {
  const parsed = PollNpmRegistryJobDataSchema.safeParse(job.data);
  if (!parsed.success) throw new Error(`invalid poll-npm job data: ${parsed.error.message}`);

  const { vendorSlug, correlationId } = parsed.data;
  const packageName = VENDOR_NPM_PACKAGES[vendorSlug];
  if (!packageName) {
    logger.warn("no npm package mapping for vendor", { vendorSlug });
    return;
  }

  const vendor = await prisma.vendor.findUnique({ where: { slug: vendorSlug } });
  if (!vendor) return;

  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    logger.warn("npm registry fetch failed", { vendorSlug, status: response.status });
    return;
  }

  const latest = (await response.json()) as { version: string; description?: string };
  const latestVersion = latest.version;

  const organizations = await prisma.organization.findMany({ select: { id: true } });
  if (organizations.length === 0) return;

  for (const org of organizations) {
    const existing = await prisma.vendorChangeEvent.findFirst({
      where: {
        vendorId: vendor.id,
        organizationId: org.id,
        externalReference: `npm:${packageName}@${latestVersion}`,
      },
    });

    if (existing) {
      continue;
    }

    const changeEvent = await prisma.vendorChangeEvent.create({
      data: {
        vendorId: vendor.id,
        organizationId: org.id,
        externalReference: `npm:${packageName}@${latestVersion}`,
        sourceType: VendorChangeSource.SDK_RELEASE,
        title: `${vendor.name} SDK ${latestVersion} release detected`,
        sourceUrl: `https://www.npmjs.com/package/${packageName}/v/${latestVersion}`,
        severity: Severity.MEDIUM,
        status: "DETECTED",
        rawPayload: { package: packageName, latestVersion },
      },
    });

    await writeAuditEvent({
      organizationId: org.id,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.CHANGE_DETECTED,
      entityType: "vendorChangeEvent",
      entityId: changeEvent.id,
      correlationId,
      after: { vendorSlug, latestVersion, packageName },
    });

    logger.info("new npm version detected and recorded for organization", {
      vendorSlug,
      latestVersion,
      organizationId: org.id,
    });
  }
}
