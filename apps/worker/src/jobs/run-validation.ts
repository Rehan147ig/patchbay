import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, PlanStatus, ValidationStatus, logger } from "@patchbay/domain";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import {
  createSandboxRunner,
  isAllowedCommand,
  type SandboxRunner,
} from "@patchbay/sandbox-runner";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";

/**
 * run-validation processor.
 *
 * The web API creates the ValidationRun row (QUEUED) and enqueues the job.
 * This processor:
 * 1. copies the repository's fixture workspace to a disposable temp dir
 *    (never mutating the fixture itself)
 * 2. applies every PatchArtifact's patched content over the copy
 * 3. runs the plan's allowlisted commands sequentially via sandbox-runner
 * 4. persists PASSED/FAILED + bounded output, advances the plan status, and
 *    writes plan.validation_started / plan.validation_passed / failed audits
 */
export const RunValidationJobDataSchema = z.object({
  validationRunId: z.string().min(1),
  remediationPlanId: z.string().min(1),
  organizationId: z.string().min(1),
  correlationId: z.string().min(1),
});
export type RunValidationJobData = z.infer<typeof RunValidationJobDataSchema>;

const CommandsSchema = z.array(z.string().min(1));

let sandboxRunner: SandboxRunner | null = null;

/** Backend for validation execution, selected once per process (env-driven). */
function runner(): SandboxRunner {
  sandboxRunner ??= createSandboxRunner();
  return sandboxRunner;
}

export interface RunValidationResult {
  validationRunId: string;
  status: "PASSED" | "FAILED";
  commandsRun: number;
  durationMs: number;
}

export async function processRunValidation(job: Job): Promise<RunValidationResult> {
  const parsed = RunValidationJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid run-validation job data: ${parsed.error.message}`);
  }
  const { validationRunId, remediationPlanId, organizationId, correlationId } = parsed.data;

  const validationRun = await prisma.validationRun.findUnique({
    where: { id: validationRunId },
  });
  if (!validationRun) {
    throw new Error(`validation run not found: ${validationRunId}`);
  }

  const plan = await prisma.remediationPlan.findUnique({
    where: { id: remediationPlanId },
    include: { impactAssessment: { include: { repository: true } }, patches: true },
  });
  if (!plan) {
    throw new Error(`remediation plan not found: ${remediationPlanId}`);
  }

  // Tenant boundary: only the owning org may run validation on this plan.
  const changeEvent = await prisma.vendorChangeEvent.findUnique({
    where: { id: plan.impactAssessment.changeEventId },
  });
  if (
    changeEvent?.organizationId !== organizationId ||
    plan.impactAssessment.repository.organizationId !== organizationId
  ) {
    logger.warn("cross-tenant validation attempt blocked", {
      validationRunId,
      remediationPlanId,
      requestedOrganizationId: organizationId,
    });
    throw new Error(
      `remediation plan ${remediationPlanId} does not belong to organization ${organizationId}`,
    );
  }

  const entity = { entityType: "remediationPlan", entityId: remediationPlanId };
  const startedAt = new Date();
  const startedClock = Date.now();

  await prisma.$transaction([
    prisma.validationRun.update({
      where: { id: validationRunId },
      data: { status: ValidationStatus.RUNNING, startedAt },
    }),
    prisma.remediationPlan.update({
      where: { id: remediationPlanId },
      data: { status: PlanStatus.VALIDATING },
    }),
  ]);
  await writeAuditEvent({
    organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.PLAN_VALIDATION_STARTED,
    correlationId,
    ...entity,
    after: { validationRunId, commandCount: commandsOf(validationRun.commands).length },
  });
  logger.info("validation started", { validationRunId, remediationPlanId, correlationId });

  const workspace = mkdtempSync(path.join(tmpdir(), "patchbay-validate-"));
  try {
    const fixture = fixtureOf(plan.impactAssessment.repository.metadata);
    if (!fixture) {
      throw new Error(`repository ${plan.impactAssessment.repositoryId} has no fixture metadata`);
    }
    const fixtureDir = resolveFixtureDir(fixture);
    cpSync(fixtureDir, workspace, {
      recursive: true,
      filter: (source) => !source.includes("node_modules"),
    });

    for (const patch of plan.patches) {
      // Path traversal guard: patch.filePath is derived from repository
      // analysis but treat it as untrusted. Absolute paths and `..`
      // traversal must never escape the disposable workspace.
      const workspaceAbs = path.resolve(workspace);
      const target = path.resolve(workspace, patch.filePath);
      if (target !== workspaceAbs && !target.startsWith(workspaceAbs + path.sep)) {
        throw new Error(`patch file path escapes the validation workspace: ${patch.filePath}`);
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, patch.patchedContent, "utf8");
    }

    const commands = commandsOf(validationRun.commands);
    for (const command of commands) {
      if (!isAllowedCommand(command)) {
        throw new Error(`command not on the validation allowlist: ${command}`);
      }
    }

    const results: Array<{
      command: string;
      ok: boolean;
      exitCode: number | null;
      durationMs: number;
      output: string;
    }> = [];
    for (const command of commands) {
      const result = await runner().run(command, workspace);
      results.push({
        command,
        ok: result.ok,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output: result.output,
      });
      if (!result.ok) break;
    }

    const passed = results.every((result) => result.ok);
    const exitCode =
      [...results].reverse().find((result) => result.exitCode !== null)?.exitCode ?? null;
    const stdout = results.map((result) => `$ ${result.command}\n${result.output}`).join("\n");

    await prisma.$transaction([
      prisma.validationRun.update({
        where: { id: validationRunId },
        data: {
          status: passed ? ValidationStatus.PASSED : ValidationStatus.FAILED,
          stdout,
          exitCode,
          completedAt: new Date(),
        },
      }),
      prisma.remediationPlan.update({
        where: { id: remediationPlanId },
        data: { status: passed ? PlanStatus.VALIDATED : PlanStatus.FAILED },
      }),
    ]);

    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: passed ? AuditAction.PLAN_VALIDATION_PASSED : AuditAction.PLAN_VALIDATION_FAILED,
      correlationId,
      ...entity,
      after: {
        validationRunId,
        results: results.map((result) => ({
          command: result.command,
          ok: result.ok,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        })),
      },
    });
    logger.info(passed ? "validation passed" : "validation failed", {
      validationRunId,
      remediationPlanId,
      correlationId,
      results: results.map((result) => ({ command: result.command, ok: result.ok })),
    });

    return {
      validationRunId,
      status: passed ? "PASSED" : "FAILED",
      commandsRun: results.length,
      durationMs: Date.now() - startedClock,
    };
  } catch (error) {
    const message = String(error);
    await prisma.$transaction([
      prisma.validationRun.update({
        where: { id: validationRunId },
        data: { status: ValidationStatus.FAILED, completedAt: new Date() },
      }),
      prisma.remediationPlan.update({
        where: { id: remediationPlanId },
        data: { status: PlanStatus.FAILED },
      }),
    ]);
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.PLAN_VALIDATION_FAILED,
      correlationId,
      ...entity,
      metadata: { validationRunId, error: message },
    });
    logger.error("validation failed", {
      validationRunId,
      remediationPlanId,
      correlationId,
      error: message,
    });
    throw error;
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(workspace, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
}

function commandsOf(commands: unknown): string[] {
  return CommandsSchema.parse(commands ?? []);
}

function fixtureOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const fixture = (metadata as { fixture?: unknown }).fixture;
  return typeof fixture === "string" && fixture.length > 0 ? fixture : null;
}
