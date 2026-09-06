import type { Job } from "bullmq";
import { AuditAction, sanitizeText } from "@patchbay/audit";
import { ActorType, logger } from "@patchbay/domain";
import { alertDlq, dlqQueue } from "@patchbay/queue";
import { writeAuditEvent } from "./audit";
import { systemOrgId } from "./system-org";
import { classifyDeliveryError } from "./delivery-attempts";
import { recordDeadLetterJob, type DeadLetterRecordInput } from "./dead-letters";

/**
 * Permanent job-failure handling. BullMQ fires `failed` on EVERY attempt, so
 * callers must only invoke this once attempts are exhausted (see
 * failedJobInfoFrom + the attempts gate below) — otherwise every transient
 * retry spams the alert channel.
 *
 * On a permanent failure this:
 * 1. fires alertDlq (Slack/PagerDuty when ALERT_WEBHOOK_URL is set, log line otherwise),
 * 2. copies the job payload to the DLQ queue for inspection/manual replay,
 * 3. records a DeadLetterJob row (redacted payload, classified error code),
 * 4. records a JOB_PERMANENTLY_FAILED audit event (job org, else system org).
 *
 * Every step is best-effort: the handler itself must never throw, or a dying
 * job takes the failure reporter down with it.
 */

export interface FailedJobInfo {
  jobType: string;
  jobId?: string;
  organizationId?: string;
  correlationId?: string;
  attemptsMade: number;
  attemptsAllowed: number;
  /** Raw job payload for the dead-letter record (redacted at write). */
  payload?: Record<string, unknown>;
}

export function failedJobInfoFrom(job: Job | undefined): FailedJobInfo {
  const data =
    job?.data !== null && typeof job?.data === "object"
      ? (job?.data as Record<string, unknown>)
      : {};
  const organizationId = typeof data.organizationId === "string" ? data.organizationId : undefined;
  const correlationId = typeof data.correlationId === "string" ? data.correlationId : undefined;
  return {
    jobType: job?.name ?? "unknown",
    jobId: job?.id,
    organizationId,
    correlationId,
    attemptsMade: job?.attemptsMade ?? 1,
    attemptsAllowed: job?.opts?.attempts ?? 1,
    payload: data,
  };
}

export interface JobFailureDeps {
  alert: (jobType: string, error: string) => Promise<void>;
  enqueueDlq: (jobType: string, data: Record<string, unknown>) => Promise<unknown>;
  recordDeadLetter: (record: DeadLetterRecordInput) => Promise<unknown>;
  audit: typeof writeAuditEvent;
  systemOrg: () => Promise<string>;
}

const defaultDeps: JobFailureDeps = {
  alert: (jobType, error) => alertDlq(jobType, error),
  enqueueDlq: (jobType, data) => dlqQueue.add(jobType, data),
  recordDeadLetter: (record) => recordDeadLetterJob(record),
  audit: (input) => writeAuditEvent(input),
  systemOrg: () => systemOrgId(),
};

/** Serialize an error including its cause chain (undici hides ECONNRESET etc. behind bare TypeErrors). */
function errorMessage(error: unknown): string {
  const parts: string[] = [];
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor !== null && cursor !== undefined; depth += 1) {
    if (cursor instanceof Error) {
      const code =
        typeof (cursor as NodeJS.ErrnoException).code === "string"
          ? ` [${(cursor as NodeJS.ErrnoException).code}]`
          : "";
      parts.push(`${cursor.name}${code}: ${cursor.message}`);
      cursor = cursor.cause;
    } else {
      parts.push(String(cursor));
      break;
    }
  }
  // Redact BEFORE truncation so a split token cannot remain sensitive.
  return sanitizeText(parts.join(" <- ")).slice(0, 2_000);
}

async function bestEffort(step: string, info: FailedJobInfo, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    logger.error(`job failure handler step failed: ${step}`, {
      jobType: info.jobType,
      jobId: info.jobId,
      error: String(error),
    });
  }
}

export async function handlePermanentlyFailedJob(
  info: FailedJobInfo,
  error: unknown,
  deps: JobFailureDeps = defaultDeps,
): Promise<void> {
  if (info.attemptsMade < info.attemptsAllowed) return;
  const message = errorMessage(error);

  await bestEffort("alert", info, () => deps.alert(info.jobType, message));
  await bestEffort("dlq", info, () =>
    deps.enqueueDlq(info.jobType, {
      jobType: info.jobType,
      jobId: info.jobId ?? null,
      failedAt: new Date().toISOString(),
      error: message,
      attemptsMade: info.attemptsMade,
      correlationId: info.correlationId ?? null,
      organizationId: info.organizationId ?? null,
    }),
  );

  const organizationId = info.organizationId ?? (await deps.systemOrg().catch(() => undefined));
  if (!organizationId) {
    logger.error("job failure audit skipped (no organization)", {
      jobType: info.jobType,
      jobId: info.jobId,
    });
    return;
  }
  // Persistent dead-letter row: redacted payload + classified code, first
  // writer wins. Best-effort like every other step — recording must never
  // break the audit below it.
  await bestEffort("dead-letter", info, () =>
    deps.recordDeadLetter({
      organizationId,
      jobType: info.jobType,
      jobId: info.jobId,
      payload: info.payload ?? {},
      errorCode: classifyDeliveryError(error),
      errorMessage: message,
      attemptsMade: info.attemptsMade,
      correlationId: info.correlationId,
    }),
  );
  await bestEffort("audit", info, () =>
    deps.audit({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.JOB_PERMANENTLY_FAILED,
      entityType: "job",
      entityId: info.jobId ?? info.jobType,
      correlationId: info.correlationId ?? null,
      after: {
        jobType: info.jobType,
        error: message,
        attemptsMade: info.attemptsMade,
      },
    }),
  );
}
