import { NextRequest } from "next/server";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, RepositoryProvider, validationFailed } from "@patchbay/domain";
import { createGitHubAppProviderFromStore } from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";
import { getCorrelationId, jsonError, jsonOk, writeAuditEvent } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { assertCsrfToken } from "@/lib/csrf-server";

/**
 * POST /api/repositories/connect
 * Connects a real GitHub repository via a GitHub App installation for the organization.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertCsrfToken(request);
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      installationId?: number;
      repositoryFullName?: string;
    };

    const { installationId, repositoryFullName } = body;
    if (!installationId || typeof installationId !== "number" || !repositoryFullName) {
      throw validationFailed(
        "installationId (number) and repositoryFullName ('owner/repo') are required",
      );
    }

    const [owner, repoName] = repositoryFullName.split("/");
    if (!owner || !repoName) {
      throw validationFailed("Invalid repositoryFullName format, expected 'owner/repo'");
    }

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
    const externalId = `github:${githubRepository.externalId}`;

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

    return jsonOk(
      { repositoryId: repository.id, fullName: githubRepository.fullName },
      correlationId,
      201,
    );
  } catch (error) {
    return jsonError(error, correlationId);
  }
}
