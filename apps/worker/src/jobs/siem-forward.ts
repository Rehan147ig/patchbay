import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction, normalizeAuditEvent } from "@patchbay/audit";
import { ActorType, logger } from "@patchbay/domain";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

/**
 * SIEM_FORWARD processor: ships unforwarded AuditEvents to the org's Splunk
 * HEC (or compatible webhook) in 100-event batches. Per-org cursor
 * (lastForwardedAt/lastForwardedId) lives in Organization.auditExportConfig
 * and advances only on success; any failure throws so BullMQ retries with
 * exponential backoff. Nothing is ever marked forwarded unless the HEC
 * acknowledged the batch — at-least-once delivery, never silent loss.
 *
 * Trust boundary: the destination URL + HEC token are ADMIN-configured per
 * org (settings UI), never derived from external input, so SSRF via this job
 * would require an ADMIN compromise — at which point the attacker already
 * owns the tenant.
 */

export const SiemForwardJobDataSchema = z.object({
  organizationId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type SiemForwardJobData = z.infer<typeof SiemForwardJobDataSchema>;

const FORWARD_BATCH_SIZE = 100;
const FORWARD_TIMEOUT_MS = 15_000;

interface SiemForwardConfig {
  enabled: boolean;
  splunkHecUrl: string;
  hecToken: string;
  lastForwardedAt: string | null;
  lastForwardedId: string | null;
}

function parseForwardConfig(raw: unknown): SiemForwardConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const config = raw as Record<string, unknown>;
  if (config.enabled !== true) return null;
  if (typeof config.splunkHecUrl !== "string" || config.splunkHecUrl.length === 0) return null;
  if (typeof config.hecToken !== "string" || config.hecToken.length === 0) return null;
  let url: URL;
  try {
    url = new URL(config.splunkHecUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return {
    enabled: true,
    splunkHecUrl: config.splunkHecUrl,
    hecToken: config.hecToken,
    lastForwardedAt: typeof config.lastForwardedAt === "string" ? config.lastForwardedAt : null,
    lastForwardedId: typeof config.lastForwardedId === "string" ? config.lastForwardedId : null,
  };
}

export interface SiemForwardResult {
  organizationId: string;
  forwarded: number;
  skipped: boolean;
}

export async function processSiemForward(job: Job): Promise<SiemForwardResult> {
  const parsed = SiemForwardJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid siem-forward job data: ${parsed.error.message}`);
  }
  const { organizationId, correlationId } = parsed.data;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, auditExportConfig: true },
  });
  if (!organization) throw new Error(`organization not found: ${organizationId}`);
  const config = parseForwardConfig(organization.auditExportConfig);
  if (!config) {
    return { organizationId, forwarded: 0, skipped: true };
  }

  const since = config.lastForwardedAt ? new Date(config.lastForwardedAt) : new Date(0);
  const events = await prisma.auditEvent.findMany({
    where: {
      organizationId,
      OR: [
        { createdAt: { gt: since } },
        ...(config.lastForwardedId
          ? [{ createdAt: since, id: { gt: config.lastForwardedId } }]
          : []),
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: FORWARD_BATCH_SIZE,
  });
  if (events.length === 0) {
    return { organizationId, forwarded: 0, skipped: true };
  }

  const payload = events
    .map((event) =>
      JSON.stringify({
        time: Math.floor(new Date(event.createdAt).getTime() / 1000),
        event: normalizeAuditEvent(event),
        source: "patchbay",
      }),
    )
    .join("\n");

  let response: Response;
  try {
    response = await fetch(config.splunkHecUrl, {
      method: "POST",
      headers: {
        Authorization: `Splunk ${config.hecToken}`,
        "Content-Type": "application/json",
      },
      body: payload,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`SIEM forward failed (network): ${String(error)}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`SIEM forward rejected: ${response.status} ${detail.slice(0, 200)}`);
  }

  const last = events[events.length - 1]!;
  const lastCreatedAt = last.createdAt instanceof Date ? last.createdAt : new Date(last.createdAt);
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      auditExportConfig: {
        ...(organization.auditExportConfig as Record<string, unknown>),
        lastForwardedAt: lastCreatedAt.toISOString(),
        lastForwardedId: last.id,
      },
    },
  });
  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.SIEM_BATCH_FORWARDED,
    entityType: "siem_forward",
    entityId: organizationId,
    correlationId,
    after: { forwarded: events.length, lastForwardedId: last.id },
  });
  logger.info("siem batch forwarded", {
    organizationId,
    correlationId,
    forwarded: events.length,
    jobName: "siem-forward",
  });
  return { organizationId, forwarded: events.length, skipped: false };
}
