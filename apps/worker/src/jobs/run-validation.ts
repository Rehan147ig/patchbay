import { mkdirSync, writeFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { prisma, Prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, PlanStatus, ValidationStatus, logger } from "@patchbay/domain";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import { assertJobPayloadSize } from "@patchbay/queue";
import {
  createSandboxRunner,
  isAllowedCommand,
  resolveSandboxValidationMode,
  type RunProvenance,
  type SandboxRunner,
} from "@patchbay/sandbox-runner";
import type { Job } from "bullmq";
import { writeAuditEvent } from "../lib/audit";
import { recordRemediationAttempt } from "../lib/case-orchestration";
import { sha256Hex } from "@patchbay/vendor-connectors";
import {
  assertInstallationBelongsToOrganization,
  resolveRepositorySource,
} from "../lib/repository-source";
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
 *
 * With SANDBOX_VALIDATION_MODE=github-checks-only the run is recorded as
 * SKIPPED instead and no command ever executes on this host — the customer's
 * CI (GitHub checks) is the validation sandbox.
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
  status: "PASSED" | "FAILED" | "SKIPPED";
  commandsRun: number;
  durationMs: number;
}

const SKIPPED_MESSAGE =
  "Validation skipped: SANDBOX_VALIDATION_MODE=github-checks-only — Patchbay does not " +
  "execute customer code on this host; customer CI (GitHub checks) is the validation sandbox.";

export async function processRunValidation(job: Job): Promise<RunValidationResult> {
  const parsed = RunValidationJobDataSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`invalid run-validation job data: ${parsed.error.message}`);
  }
  const { validationRunId, remediationPlanId, organizationId, correlationId } = parsed.data;

  // Consumer-side payload re-assertion: the enqueue path enforces the cap, but
  // a direct Redis writer must not be able to fetch oversized payloads into
  // worker memory before schema rejection.
  assertJobPayloadSize(job.data);

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

  // Integrity: the validation run must belong to THIS plan. A mismatched
  // enqueue would otherwise write this plan's results onto another plan's row.
  if (validationRun.remediationPlanId !== remediationPlanId) {
    throw new Error(
      `validation run ${validationRunId} does not belong to plan ${remediationPlanId}`,
    );
  }

  // Tenant boundary: only the owning org may run validation on this plan. The
  // change-event check applies to release-funnel assessments; contract-flow
  // assessments (WP4) carry no change event, so they skip that leg while the
  // repository-ownership check below still applies unconditionally.
  const changeEvent = plan.impactAssessment.changeEventId
    ? await prisma.vendorChangeEvent.findUnique({
        where: { id: plan.impactAssessment.changeEventId },
      })
    : null;
  if (
    (changeEvent !== null && changeEvent.organizationId !== organizationId) ||
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

  // github-checks-only: never execute customer code on this host. The run is
  // recorded as SKIPPED (never PASSED) and the plan status is left untouched so
  // draft-PR policy still applies as-is (SKIPPED is not a passing validation).
  if (resolveSandboxValidationMode() === "github-checks-only") {
    await prisma.validationRun.update({
      where: { id: validationRunId },
      data: {
        status: ValidationStatus.SKIPPED,
        stdout: SKIPPED_MESSAGE,
        completedAt: new Date(),
      },
    });
    await writeAuditEvent({
      organizationId,
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: AuditAction.PLAN_VALIDATION_SKIPPED,
      correlationId,
      ...entity,
      after: { validationRunId, reason: "customer CI is the validation sandbox" },
    });
    await recordRemediationAttempt({
      caseId: plan.remediationCaseId ?? null,
      strategyId: strategyOf(plan),
      inputHash: sha256Hex(JSON.stringify(validationRun.commands ?? [])),
      status: "SKIPPED",
      organizationId,
      correlationId,
    });
    logger.info("validation skipped (github-checks-only)", {
      validationRunId,
      remediationPlanId,
      correlationId,
    });
    return { validationRunId, status: "SKIPPED", commandsRun: 0, durationMs: 0 };
  }

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
  const cloneUrl = cloneUrlOf(repository.metadata);
  const isGitHubCheckout = repository.provider === "GITHUB" && Boolean(installationId);
  if (installationId) {
    // Tenant boundary: metadata installation ids are only usable when bound to
    // the repository's own organization (prevents cross-tenant source access).
    await assertInstallationBelongsToOrganization(
      installationId,
      plan.impactAssessment.repository.organizationId,
    );
  }
  const provider = isGitHubCheckout
    ? createGitProviderFromEnv({
        // Narrowed by isGitHubCheckout (installation id is a positive integer there).
        installationId: installationId as number,
        repositoryFullName: repository.fullName,
        baseBranch: repository.defaultBranch ?? undefined,
      })
    : createGitProviderFromEnv();

  let workspace: string;
  if (fixtureDir) {
    // Fixture fast path: disposable copy of the local fixture directory.
    const checkoutResult = await provider.checkout({
      repositoryDir: resolveFixtureDir(fixtureDir),
      baseBranch: repository.defaultBranch,
    });
    workspace = checkoutResult.workspaceDir;
  } else if (cloneUrl) {
    // Controlled plain-clone transport (public demo repositories): shallow
    // argv clone of a credential-free github.com URL. Workspace removal stays
    // in the shared finally below.
    const source = await resolveRepositorySource({
      id: repository.id,
      provider: repository.provider,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      organizationId: plan.impactAssessment.repository.organizationId,
      metadata: repository.metadata,
    });
    if (source.kind !== "clone") throw new Error("unexpected source kind for cloneUrl metadata");
    workspace = source.rootDir;
  } else {
    // GitHub App checkout path: exact HEAD resolved through the API.
    const sha = isGitHubCheckout
      ? await provider.resolveHeadSha(repository.defaultBranch ?? undefined)
      : undefined;
    const checkoutResult = await provider.checkout({
      ...(installationId ? { installationId } : {}),
      ...(sha ? { sha } : {}),
      baseBranch: repository.defaultBranch,
    });
    workspace = checkoutResult.workspaceDir;
  }

  try {
    // Symlink-hardened workspace boundary: resolve the real workspace path once
    // (checkout dirs are not symlinks themselves), then verify each patch's
    // parent directory through realpath so a repo-controlled symlink cannot
    // redirect writes outside the disposable workspace.
    const workspaceReal = realpathSync(workspace);
    for (const patch of plan.patches) {
      // Path traversal guard: patch.filePath is derived from repository
      // analysis but treat it as untrusted. Absolute paths and `..`
      // traversal must never escape the disposable workspace.
      const target = path.resolve(workspaceReal, patch.filePath);
      if (target !== workspaceReal && !target.startsWith(workspaceReal + path.sep)) {
        throw new Error(`patch file path escapes the validation workspace: ${patch.filePath}`);
      }
      mkdirSync(path.dirname(target), { recursive: true });
      const parentReal = realpathSync(path.dirname(target));
      if (parentReal !== workspaceReal && !parentReal.startsWith(workspaceReal + path.sep)) {
        throw new Error(
          `patch target resolves outside the validation workspace via symlink: ${patch.filePath}`,
        );
      }
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
    const totalDurationMs = Date.now() - startedClock;
    logger.info("job completed", {
      correlationId,
      organizationId,
      repositoryId: repository.id,
      remediationPlanId,
      validationRunId,
      jobName: "run-validation",
      durationMs: totalDurationMs,
      outcome: passed ? "PASSED" : "FAILED",
      results: results.map((result) => ({ command: result.command, ok: result.ok })),
    });
    await recordRemediationAttempt({
      caseId: plan.remediationCaseId ?? null,
      strategyId: strategyOf(plan),
      inputHash: sha256Hex(JSON.stringify(validationRun.commands ?? [])),
      outputHash: sha256Hex(stdout),
      status: passed ? "SUCCEEDED" : "FAILED",
      organizationId,
      correlationId,
    });

    return {
      validationRunId,
      status: passed ? "PASSED" : "FAILED",
      commandsRun: results.length,
      durationMs: totalDurationMs,
    };
  } catch (error) {
    const message = String(error).slice(0, 4000);
    await prisma.$transaction([
      prisma.validationRun.update({
        where: { id: validationRunId },
        data: {
          status: ValidationStatus.FAILED,
          completedAt: new Date(),
          stdout: `validation harness error: ${message}`.slice(0, 4000),
          stderr: message,
          exitCode: -1,
        },
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
    await recordRemediationAttempt({
      caseId: plan.remediationCaseId ?? null,
      strategyId: strategyOf(plan),
      inputHash: sha256Hex(JSON.stringify(validationRun.commands ?? [])),
      status: "FAILED",
      failureCode: message.slice(0, 200),
      organizationId,
      correlationId,
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

/** Plan strategy label for attempt records; defensive for partial (mock) rows. */
function strategyOf(plan: { strategy?: unknown }): string {
  return typeof plan.strategy === "string" && plan.strategy ? plan.strategy : "unknown";
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

function cloneUrlOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as { cloneUrl?: unknown }).cloneUrl;
  return typeof value === "string" && value.length > 0 ? value : null;
}
