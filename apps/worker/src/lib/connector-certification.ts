import { prisma } from "@patchbay/db";
import { listCapabilities } from "@patchbay/vendor-connectors";
import { logger } from "@patchbay/domain";

/**
 * Certification registry mirror (WP5, spec §4.1).
 *
 * Copies the static capability registry (capabilities.ts — the certified
 * source of truth, gated by the eval corpus) into ConnectorCertification
 * rows so operations views can query certification state without importing
 * connector code. Precision and success-rate metrics start null: they are
 * measured by evaluations (WP10), never asserted statically.
 *
 * Idempotent and version-aware: re-running converges (upsert by
 * connector+version); a connector whose rule-pack version moved has its older
 * CERTIFIED rows marked EXPIRED so stale kits can never look current.
 */

export interface CertificationSyncResult {
  synced: number;
  expired: number;
}

export async function syncConnectorCertifications(): Promise<CertificationSyncResult> {
  const entries = listCapabilities();
  let synced = 0;
  let expired = 0;
  for (const entry of entries) {
    const version = entry.rulePackVersion ?? "unversioned";
    // Measured corpus metrics map onto the record honestly: usage precision
    // is the precision signal, patch-validation rate is the patch signal;
    // validation success has no separate measurement, so it stays null rather
    // than duplicating another metric.
    const metrics = entry.corpus?.metrics;
    const data = {
      capability: entry.level,
      corpusVersion: entry.corpus?.id ?? null,
      precision: metrics ? metrics.affectedUsagePrecisionPct / 100 : null,
      patchSuccessRate: metrics ? metrics.patchValidationPct / 100 : null,
      validationSuccessRate: null as number | null,
      status: "CERTIFIED",
    };
    await prisma.connectorCertification.upsert({
      where: { connectorSlug_version: { connectorSlug: entry.vendorSlug, version } },
      create: {
        connectorSlug: entry.vendorSlug,
        version,
        ...data,
        approvedBy: "system:corpus-gate",
      },
      update: data,
    });
    synced += 1;
    const stale = await prisma.connectorCertification.updateMany({
      where: { connectorSlug: entry.vendorSlug, version: { not: version }, status: "CERTIFIED" },
      data: { status: "EXPIRED" },
    });
    expired += stale.count;
  }
  logger.info("connector certifications synced", { synced, expired });
  return { synced, expired };
}
