import { prisma } from "@patchbay/db";
import { CapabilityGateStatus } from "@patchbay/domain";

/**
 * Worker-side capability kill-switch check (WP5 gate parity).
 *
 * Mirrors apps/web/src/lib/capability-gates.ts intentionally instead of
 * importing across apps: the web and worker processes must enforce identical
 * refusal semantics from their own side of the boundary. A suspended gate
 * fails loudly here so the job lands in the DLQ path (alert + audit) instead
 * of silently skipping PR creation.
 */
export async function assertWorkerCapabilityGateOpen(
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
    throw new Error(
      `Capability ${vendorSlug}@${level} is suspended: ${gate.reason ?? "administrative hold"}`,
    );
  }
}
