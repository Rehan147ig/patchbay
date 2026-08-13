/**
 * Daemon update task: consumes task parameters created by the submission
 * endpoint or the seed. Two entry points share one path:
 *
 * - UPDATE_TASK_PARAMETER BullMQ job (immediate, from the submission route).
 * - sweepPendingTaskParameters (periodic, from the worker loop) picks up any
 *   PENDING parameter that was never enqueued (seeded tasks, restarts).
 *
 * Execution is claim-based and idempotent: the claim is atomic, so duplicate
 * jobs or an overlapping sweep never double-execute a run.
 *
 * Executors are deterministic and allowlisted by domain: the NPM executor
 * only ever reads the npm registry for products in NPM_PACKAGE_ALLOWLIST;
 * it never fetches caller-supplied URLs. Other-domain executors arrive with
 * the Watchtower adapters (docs/RELEASE-WATCHTOWER.md).
 */
import { z } from "zod";
import { claimTaskParameter, completeTaskParameter, failTaskParameter, prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, logger } from "@patchbay/domain";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

const NPM_PACKAGE_ALLOWLIST: ReadonlySet<string> = new Set(["openai", "stripe", "twilio", "auth0"]);

function assertAllowedNpmPackage(packageName: string, taskId: string): void {
  if (!NPM_PACKAGE_ALLOWLIST.has(packageName)) {
    throw new Error(`npm package "${packageName}" is not in the domain allowlist for ${taskId}`);
  }
}

interface NpmObservation {
  packageName: string;
  latestVersion: string;
  description: string | null;
  observedAt: string;
}

async function runNpmObservation(input: Record<string, unknown>): Promise<NpmObservation> {
  const packageName = input.packageName as string;
  if (typeof packageName !== "string" || packageName.length === 0) {
    throw new Error("NPM observation requires input.packageName");
  }
  assertAllowedNpmPackage(packageName, String(input.taskId ?? "unknown"));

  const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry fetch failed with status ${response.status}`);
  }
  const latest = (await response.json()) as { version?: string; description?: string };
  if (typeof latest.version !== "string" || latest.version.length === 0) {
    throw new Error("npm registry response is missing version");
  }
  return {
    packageName,
    latestVersion: latest.version,
    description: latest.description ?? null,
    observedAt: new Date().toISOString(),
  };
}

export const UpdateTaskParameterJobDataSchema = z.object({
  taskId: z.string().min(1),
  type: z.string().min(1),
  domain: z.enum(["NPM", "GITHUB_RELEASE", "OPENAPI", "VENDOR_MANIFEST", "CHANGELOG"]),
  organizationId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type UpdateTaskParameterJobData = z.infer<typeof UpdateTaskParameterJobDataSchema>;

const DOMAIN_EXECUTORS: Record<UpdateTaskParameterJobData["domain"], string> = {
  NPM: "npm-observation",
  GITHUB_RELEASE: "unwired",
  OPENAPI: "unwired",
  VENDOR_MANIFEST: "unwired",
  CHANGELOG: "unwired",
};

interface ExecuteContext {
  organizationId: string;
  correlationId?: string;
}

async function executeTaskParameter(
  taskId: string,
  type: string,
  context: ExecuteContext,
): Promise<void> {
  const claimed = await claimTaskParameter(taskId, type);
  if (!claimed) return;

  const parameter = await prisma.taskParameter.findUnique({
    where: { taskId_type: { taskId, type } },
  });
  if (!parameter) return;

  const domain = (parameter.domain as UpdateTaskParameterJobData["domain"]) ?? "NPM";

  await writeAuditEvent({
    organizationId: context.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.TASK_CLAIMED,
    entityType: "taskParameter",
    entityId: parameter.id,
    correlationId: context.correlationId,
    after: { taskId, type, domain, reclaimed: claimed.reclaimed },
  });

  try {
    if (DOMAIN_EXECUTORS[domain] === "unwired") {
      throw new Error(`no executor is wired for domain "${domain}"`);
    }
    const input = (parameter.inputJson ?? {}) as Record<string, unknown>;
    const output = await runNpmObservation({ ...input, taskId });
    await completeTaskParameter(taskId, type, output as never);

    await writeAuditEvent({
      organizationId: context.organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.TASK_COMPLETED,
      entityType: "taskParameter",
      entityId: parameter.id,
      correlationId: context.correlationId,
      after: { taskId, type, domain, output },
    });
    logger.info("task parameter completed", {
      taskId,
      type,
      domain,
      latestVersion: output.latestVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failTaskParameter(taskId, type, message);

    await writeAuditEvent({
      organizationId: context.organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.TASK_FAILED,
      entityType: "taskParameter",
      entityId: parameter.id,
      correlationId: context.correlationId,
      after: { taskId, type, domain, error: message },
    });
    logger.error("task parameter failed", { taskId, type, domain, error: message });
    throw error;
  }
}

export async function processUpdateTaskParameter(job: Job): Promise<void> {
  const parsed = UpdateTaskParameterJobDataSchema.safeParse(job.data);
  if (!parsed.success)
    throw new Error(`invalid update-task-parameter job data: ${parsed.error.message}`);

  await executeTaskParameter(parsed.data.taskId, parsed.data.type, {
    organizationId: parsed.data.organizationId,
    correlationId: parsed.data.correlationId,
  });
}

/**
 * Periodic sweep: executes any PENDING task parameter that was never
 * enqueued (seeded domains, submissions whose job was lost). Claims keep it
 * idempotent against the job path.
 */
export async function sweepPendingTaskParameters(): Promise<number> {
  const pending = await prisma.taskParameter.findMany({
    where: { status: "PENDING" },
    select: { taskId: true, type: true, inputJson: true },
    take: 25,
  });
  for (const parameter of pending) {
    const organizationId = (parameter.inputJson as Record<string, unknown> | null)?.organizationId;
    await executeTaskParameter(parameter.taskId, parameter.type, {
      organizationId: typeof organizationId === "string" ? organizationId : "org-acme",
    });
  }
  if (pending.length > 0) {
    logger.info("task parameter sweep", { count: pending.length });
  }
  return pending.length;
}
