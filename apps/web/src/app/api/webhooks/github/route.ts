import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, PatchbayError, logger, unauthorized } from "@patchbay/domain";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { verifyGitHubWebhookSignature } from "@/lib/github-webhook";
import { isAllowedPullRequestTransition, resolveNextPullRequestStatus } from "@/lib/pr-status";

/**
 * POST /api/webhooks/github
 *
 * GitHub App webhook receiver. Authenticated by HMAC signature (not a user
 * session — the middleware whitelists /api/webhooks/*). Always answers 200
 * for well-formed, correctly signed deliveries so GitHub does not retry
 * events we cannot process; only signature/parse failures get non-200.
 */

const InstallationPayloadSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number().int(),
    account: z.object({ login: z.string(), type: z.string() }),
    repository_selection: z.string(),
    permissions: z.record(z.string(), z.string()),
    suspended_at: z.string().nullable().optional(),
  }),
});

const PullRequestPayloadSchema = z.object({
  action: z.string(),
  repository: z.object({ id: z.number() }),
  pull_request: z.object({
    number: z.number().int(),
    state: z.string(),
    merged: z.boolean().optional(),
    draft: z.boolean().optional(),
  }),
});

/** Replays of an identical payload inside this window are dropped. */
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

export async function POST(request: NextRequest): Promise<Response> {
  const correlationId = getCorrelationId(request);
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  const event = request.headers.get("x-github-event") ?? "";
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const payload = await request.text();

  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET ?? "";
  if (!verifyGitHubWebhookSignature(payload, signature, secret)) {
    logger.warn("github webhook rejected: invalid signature", { correlationId, deliveryId });
    return jsonError(unauthorized("Invalid webhook signature"), correlationId);
  }

  if (!deliveryId) {
    return jsonError(unauthorized("Missing GitHub delivery ID"), correlationId);
  }

  const payloadHash = createHash("sha256").update(payload).digest("hex");

  // Replay window: GitHub retries an event with a NEW delivery ID, so the
  // unique deliveryId alone cannot catch replays. Drop identical payloads
  // processed within the window (an attacker replaying a captured delivery
  // would have to do so inside the window AND with a fresh signature).
  const recentReplay = await prisma.webhookDelivery.findFirst({
    where: {
      payloadHash,
      receivedAt: { gt: new Date(Date.now() - REPLAY_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recentReplay) {
    return jsonOk({ received: true, deliveryId, event, duplicate: true }, correlationId);
  }

  const receipt = await prisma.webhookDelivery
    .create({
      data: {
        deliveryId,
        event,
        payloadHash,
      },
    })
    .catch((error: unknown) => {
      if (String(error).includes("Unique constraint")) return null;
      throw error;
    });
  if (!receipt) {
    return jsonOk({ received: true, deliveryId, event, duplicate: true }, correlationId);
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return jsonError(
      new PatchbayError("Webhook payload must be valid JSON", {
        statusCode: 400,
        code: "BAD_REQUEST",
      }),
      correlationId,
    );
  }

  try {
    if (event === "installation") {
      await handleInstallation(InstallationPayloadSchema.parse(body), correlationId);
    } else if (event === "pull_request") {
      await handlePullRequest(PullRequestPayloadSchema.parse(body), correlationId);
    } else {
      logger.info("github webhook ignored (unhandled event type)", { correlationId, event });
    }
  } catch (error) {
    await prisma.webhookDelivery.update({
      where: { id: receipt.id },
      data: { status: "FAILED", error: String(error).slice(0, 2_000) },
    });
    logger.error("github webhook handler failed", {
      correlationId,
      deliveryId,
      event,
      error: String(error),
    });
    return jsonError(error, correlationId);
  }

  await prisma.webhookDelivery.update({
    where: { id: receipt.id },
    data: { status: "PROCESSED", processedAt: new Date() },
  });

  return jsonOk({ received: true, deliveryId, event }, correlationId);
}

type InstallationPayload = z.infer<typeof InstallationPayloadSchema>;

async function handleInstallation(
  payload: InstallationPayload,
  correlationId: string,
): Promise<void> {
  const { action, installation } = payload;

  if (action === "deleted" || action === "suspend") {
    await prisma.gitHubInstallation.updateMany({
      where: { installationId: installation.id },
      data: { suspendedAt: new Date() },
    });
    logger.info("github installation suspended", { installationId: installation.id, action });
    return;
  }

  if (action === "created" || action === "unsuspend" || action === "new_permissions_accepted") {
    // The organization binding is established by the authenticated install
    // callback (/api/github/callback). Here we only enrich/suspend rows that
    // already exist — a webhook alone must never create tenant bindings.
    const result = await prisma.gitHubInstallation.updateMany({
      where: { installationId: installation.id },
      data: {
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        repositorySelection: installation.repository_selection,
        permissions: installation.permissions,
        suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
      },
    });
    if (result.count === 0) {
      logger.info(
        "github installation webhook arrived before callback; awaiting install callback",
        {
          installationId: installation.id,
        },
      );
      return;
    }

    const row = await prisma.gitHubInstallation.findUnique({
      where: { installationId: installation.id },
      select: { organizationId: true },
    });
    if (row) {
      await writeAuditEvent({
        organizationId: row.organizationId,
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: AuditAction.GITHUB_INSTALLATION_SYNCED,
        entityType: "gitHubInstallation",
        entityId: String(installation.id),
        correlationId,
        after: {
          installationId: installation.id,
          account: installation.account.login,
          action,
        },
      });
    }
  }
}

type PullRequestPayload = z.infer<typeof PullRequestPayloadSchema>;

async function handlePullRequest(
  payload: PullRequestPayload,
  correlationId: string,
): Promise<void> {
  const { action, repository, pull_request: pr } = payload;

  const nextStatus = resolveNextPullRequestStatus({
    action,
    merged: pr.merged,
    draft: pr.draft,
  });
  if (!nextStatus) return;

  // Scope by the GitHub repository id AND the PR number — PR numbers are only
  // unique within a repository.
  const pullRequest = await prisma.pullRequest.findFirst({
    where: {
      externalId: String(pr.number),
      remediationPlan: {
        impactAssessment: { repository: { externalId: String(repository.id) } },
      },
    },
    select: { id: true, organizationId: true, status: true },
  });
  if (!pullRequest || pullRequest.status === nextStatus) return;
  if (!isAllowedPullRequestTransition(pullRequest.status, nextStatus)) return;

  await prisma.pullRequest.update({
    where: { id: pullRequest.id },
    data: { status: nextStatus },
  });

  await writeAuditEvent({
    organizationId: pullRequest.organizationId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    action: AuditAction.PR_STATUS_SYNCED,
    entityType: "pullRequest",
    entityId: pullRequest.id,
    correlationId,
    before: { status: pullRequest.status },
    after: { status: nextStatus, githubPrNumber: pr.number },
  });
}
