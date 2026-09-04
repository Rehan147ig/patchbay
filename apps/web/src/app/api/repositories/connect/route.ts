import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, RepositoryProvider, ScanStatus, validationFailed } from "@patchbay/domain";
import { createGitHubAppProviderFromStore } from "@patchbay/git-provider";
import { enqueue, JobType } from "@patchbay/queue";
import { getSecretStore } from "@patchbay/env";
import { getCorrelationId, jsonError, jsonOk, parseBodyBounded, writeAuditEvent } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";
import { assertRepositoryCapacity, countActiveRepositories } from "@/lib/billing";

const connectRepositorySchema = z.object({
  installationId: z.number().int().positive(),
  repositoryFullName: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/, "expected 'owner/repo'"),
});

/**
 * POST /api/repositories/connect
 * Connects a real GitHub repository via a GitHub App installation for the organization.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireRole("MEMBER");
    const body = await parseBodyBounded(request, connectRepositorySchema, 16 * 1024);

    const { installationId, repositoryFullName } = body;

    // Verify this installation belongs to the user's organization
    const installation = await prisma.gitHubInstallation.findFirst({
      where: { organizationId: user.organizationId, installationId, suspendedAt: null },
    });
    if (!installation) {
      throw validationFailed("GitHub installation not found for your organization");
    }

    const provider = await createGitHubAppProviderFromStore(
      { installationId, repositoryFullName },
      getSecretStore(),
    );
    const githubRepository = await provider.fetchRepositoryInfo();
    // Canonical externalId is the bare GitHub repository id (String(repo.id)),
    // matching the provider, the install-callback flow, and the push/PR
    // webhook readers. Never prefix it: a `github:` prefix here silently
    // breaks push-webhook matching for picker-connected repositories.
    const externalId = githubRepository.externalId;

    const existing = await prisma.repository.findUnique({
      where: {
        organizationId_externalId: {
          organizationId: user.organizationId,
          externalId,
        },
      },
    });
    if (!existing) {
      const activeCount = await countActiveRepositories(user.organizationId);
      await assertRepositoryCapacity(user.organizationId, activeCount);
    }

    const repository = await prisma.repository.upsert({
      where: {
        organizationId_externalId: {
          organizationId: user.organizationId,
          externalId,
        },
      },
      update: {
        name: githubRepository.name,
        fullName: githubRepository.fullName,
        defaultBranch: githubRepository.defaultBranch,
        metadata: { installationId, externalId, provider: "GITHUB" },
      },
      create: {
        organizationId: user.organizationId,
        provider: RepositoryProvider.GITHUB,
        externalId,
        name: githubRepository.name,
        fullName: githubRepository.fullName,
        defaultBranch: githubRepository.defaultBranch,
        languageProfile: { typescript: true },
        metadata: { installationId, externalId, provider: "GITHUB" },
      },
    });

    await writeAuditEvent({
      organizationId: user.organizationId,
      actorType: ActorType.USER,
      actorId: user.id,
      action: AuditAction.REPOSITORY_REGISTERED,
      entityType: "repository",
      entityId: repository.id,
      correlationId,
      after: { fullName: githubRepository.fullName, provider: "GITHUB" },
    });

    // Parity with install-callback flow: queue an initial scan so a manually
    // connected repo never sits at "Never scanned". Best-effort: connect
    // succeeds even if scan enqueue fails; the Scan button remains available.
    try {
      const scan = await prisma.repositoryScan.create({
        data: {
          organizationId: user.organizationId,
          repositoryId: repository.id,
          commitSha: "pending",
          status: ScanStatus.QUEUED,
        },
      });
      await enqueue(JobType.SCAN_REPOSITORY, {
        repositoryId: repository.id,
        scanId: scan.id,
        correlationId,
      });
    } catch {
      // Best-effort only; connect already succeeded.
    }

    return jsonOk(
      { repositoryId: repository.id, fullName: githubRepository.fullName },
      correlationId,
      201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
