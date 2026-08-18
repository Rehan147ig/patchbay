import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma, Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, PlanStatus, ValidationStatus, logger } from "@patchbay/domain";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import {
  createSandboxRunner,
  isAllowedCommand,
  type RunProvenance,
  type SandboxRunner,
} from "@patchbay/sandbox-runner";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";
import { createGitProviderFromEnv } from "@patchbay/git-provider";

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
  if (!sandboxRunner) {
    sandboxRunner = createSandboxRunner();
    void sandboxRunner.isAvailable().then((available) => {
      if (!available) {
        logger.warn(
          `sandbox runtime ${sandboxRunner?.runtime} is not available on this host; ` +
            "validation jobs will fail loudly until SANDBOX_RUNTIME=process is restored",
        );
      }
    });
  }
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
    include: {
      impactAssessment: {
        include: {
          repository: true,
        },
      },
      patches: true,
    },
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

  // Create git provider based on repository type
  const repository = plan.impactAssessment.repository;
  const installationId = installationIdOf(repository.metadata);
  const fixtureDir = fixtureOf(repository.metadata);
  const provider =
    repository.provider === "GITHUB" && installationId
      ? createGitProviderFromEnv({
          installationId,
          repositoryFullName: repository.fullName,
          baseBranch: repository.defaultBranch ?? undefined,
        })
      : createGitProviderFromEnv();

  // Checkout repository to a disposable workspace
  const checkoutResult = await provider.checkout({
    ...(fixtureDir ? { repositoryDir: resolveFixtureDir(fixtureDir) } : {}),
    ...(installationId ? { installationId } : {}),
    ...(headShaOf(repository.metadata) ? { sha: headShaOf(repository.metadata)! } : {}),
    baseBranch: repository.defaultBranch,
  });
  const workspace = checkoutResult.workspaceDir;

  try {
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
      provenance: RunProvenance | null;
    }> = [];
    for (const command of commands) {
      const result = await runner().run(command, workspace);
      results.push({
        command,
        ok: result.ok,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output: result.output,
        provenance: result.provenance ?? null,
      });
      if (!result.ok) break;
    }

    const passed = results.every((result) => result.ok);
    const exitCode =
      [...results].reverse().find((result) => result.exitCode !== null)?.exitCode ?? null;
    const stdout = results.map((result) => `$ ${result.command}\n${result.output}`).join("\n");
    const provenance = results.map((result) => result.provenance).find(Boolean) ?? null;

    await prisma.$transaction([
      prisma.validationRun.update({
        where: { id: validationRunId },
        data: {
          status: passed ? ValidationStatus.PASSED : ValidationStatus.FAILED,
          stdout,
          exitCode,
          runtimeMetadata: provenance
            ? ({
                runtime: provenance.runtime,
                mode: provenance.mode,
                imageDigest: provenance.imageDigest,
                networkPolicy: provenance.networkPolicy,
                limits: provenance.limits,
                workspace: provenance.workspace,
                failureClass: provenance.failureClass,
              } satisfies Prisma.InputJsonValue)
            : Prisma.JsonNull,
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

function installationIdOf(metadata: unknown): number | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as { installationId?: unknown }).installationId;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function headShaOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as { headSha?: unknown }).headSha;
  return typeof value === "string" && value.length > 0 ? value : null;
}
