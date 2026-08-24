import { resolveFixtureDir } from "@patchbay/repo-analysis";
import {
  createGitHubAppProviderFromStore,
  resolveRepositorySource as resolveRepositorySourceShared,
  type RepositorySource,
} from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";
import { prisma } from "@patchbay/db";

export type { RepositorySource };

/**
 * Worker binding of the shared repository-source resolver: injects the Prisma
 * installation-ownership lookup, the App-installation provider factory, and
 * the hardened fixture resolution. All worker jobs consume this wrapper; web
 * routes bind their own identical deps from the shared package.
 */
export async function resolveRepositorySource(repository: {
  id: string;
  provider: string;
  fullName: string | null;
  defaultBranch: string | null;
  organizationId: string;
  metadata: unknown;
}): Promise<RepositorySource> {
  return resolveRepositorySourceShared(repository, {
    async findInstallationOrganizationId(installationId) {
      const installation = await prisma.gitHubInstallation.findUnique({
        where: { installationId },
        select: { organizationId: true },
      });
      return installation?.organizationId ?? null;
    },
    async createInstallationProvider({ installationId, repositoryFullName }) {
      return createGitHubAppProviderFromStore(
        { installationId, repositoryFullName },
        getSecretStore(),
      );
    },
    resolveFixtureDir,
  });
}

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
  const owner = await prisma.gitHubInstallation.findUnique({
    where: { installationId },
    select: { organizationId: true },
  });
  if (!owner || owner.organizationId !== organizationId) {
    throw new Error(
      `installation ${installationId} is not bound to organization ${organizationId}`,
    );
  }
}
