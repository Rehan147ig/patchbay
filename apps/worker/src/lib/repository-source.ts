import { resolveFixtureDir } from "@patchbay/repo-analysis";
import { createGitHubAppProviderFromStore } from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";
import { prisma } from "@patchbay/db";

/**
 * Resolves where a repository's source lives before analysis:
 * - fixtures: local filesystem copy (demo/offline), no checkout
 * - GitHub installations: exact-HEAD checkout through the GitHub App
 *   installation token; the workspace is removed by the provider after use
 */
export type RepositorySource =
  | { kind: "fixture"; fixture: string; rootDir: string }
  | {
      kind: "github";
      installationId: number;
      commitSha: string;
      rootDir: string;
    };

/**
 * Tenant boundary for installation checkouts: an installation id found in
 * repository metadata is only usable when it is bound to the SAME organization
 * as the repository row. Prevents a member from pointing their repository at
 * another tenant's installation id to exfiltrate private source.
 */
export async function assertInstallationBelongsToOrganization(
  installationId: number,
  organizationId: string,
): Promise<void> {
  const installation = await prisma.gitHubInstallation.findUnique({
    where: { installationId },
    select: { organizationId: true },
  });
  if (!installation || installation.organizationId !== organizationId) {
    throw new Error(
      `installation ${installationId} is not bound to organization ${organizationId}`,
    );
  }
}

export async function resolveRepositorySource(repository: {
  id: string;
  provider: string;
  fullName: string | null;
  defaultBranch: string | null;
  organizationId: string;
  metadata: unknown;
}): Promise<RepositorySource> {
  const fixture = fixtureOf(repository.metadata);
  if (fixture) {
    return { kind: "fixture", fixture, rootDir: resolveFixtureDir(fixture) };
  }

  const installationId = installationIdOf(repository.metadata);
  if (repository.provider === "GITHUB" && installationId) {
    if (!repository.fullName) {
      throw new Error(`repository ${repository.id} has no fullName for GitHub checkout`);
    }
    await assertInstallationBelongsToOrganization(installationId, repository.organizationId);
    const provider = await createGitHubAppProviderFromStore(
      { installationId, repositoryFullName: repository.fullName },
      getSecretStore(),
    );
    const commitSha = await provider.resolveHeadSha(repository.defaultBranch ?? undefined);
    const checkout = await provider.checkout({
      sha: commitSha,
      baseBranch: repository.defaultBranch ?? undefined,
      repositoryFullName: repository.fullName,
    });
    return {
      kind: "github",
      installationId,
      commitSha,
      rootDir: checkout.workspaceDir,
    };
  }

  throw new Error(
    `repository ${repository.id} has no fixture metadata and is not a GitHub installation`,
  );
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
