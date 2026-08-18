import { prisma } from "@patchbay/db";
import { CapabilityGateStatus, validationFailed } from "@patchbay/domain";

/**
 * Runtime kill switch check (WP10). Certification (requireCertified) is the
 * static registry; this is the dynamic org-scoped gate that admin action or
 * auto-suspend can close. A suspended gate fails the request loudly so no
 * job is ever enqueued for a suspended capability.
 */
export async function assertCapabilityGateOpen(
  organizationId: string,
  vendorSlug: string,
  level: string,
): Promise<void> {
  const gate = await prisma.capabilityGate.findUnique({
    where: {
      organizationId_vendorSlug_level: { organizationId, vendorSlug, level },
    },
    select: { status: true, reason: true },
  });
  if (gate?.status === CapabilityGateStatus.SUSPENDED) {
    throw validationFailed(
      `Capability ${vendorSlug}@${level} is suspended: ${gate.reason ?? "administrative hold"}`,
    );
  }
}
