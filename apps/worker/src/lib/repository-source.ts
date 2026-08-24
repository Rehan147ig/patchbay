import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveFixtureDir } from "@patchbay/repo-analysis";
import {
  assertSafeRepoFullName,
  createGitHubAppProviderFromStore,
  runGit,
} from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";
import { prisma } from "@patchbay/db";

/**
 * Resolves where a repository's source lives before analysis:
 * - fixtures: local filesystem copy (demo/offline), no checkout
 * - GitHub installations: exact-HEAD checkout through the GitHub App
 *   installation token
 * - controlled plain clone: credential-free github.com HTTPS URL (demo/public
 *   repositories), shallow argv clone — never an arbitrary URL
 *
 * Every non-fixture source returns a `cleanup()` that removes its disposable
 * workspace; callers MUST run it in a finally block.
 */
export type RepositorySource =
  | { kind: "fixture"; fixture: string; rootDir: string; cleanup(): void }
  | {
      kind: "github";
      installationId: number;
      commitSha: string;
      rootDir: string;
      cleanup(): void;
    }
  | {
      kind: "clone";
      /** Credential-free https://github.com/owner/repo URL. */
      cloneUrl: string;
      rootDir: string;
      cleanup(): void;
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
    return {
      kind: "fixture",
      fixture,
      rootDir: resolveFixtureDir(fixture),
      cleanup() {
        // Fixtures are read-only repo content; nothing to remove.
      },
    };
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
      cleanup() {
        rmSync(checkout.workspaceDir, { recursive: true, force: true });
      },
    };
  }

  const cloneUrl = cloneUrlOf(repository.metadata);
  if (repository.provider === "GITHUB" && cloneUrl) {
    return cloneRepository(repository.id, cloneUrl);
  }

  throw new Error(
    `repository ${repository.id} has no fixture or clone metadata and is not a GitHub installation`,
  );
}

/**
 * Controlled plain clone for demo/public repositories. The URL must be a bare
 * credential-free https://github.com/owner/repo form (re-validated here even
 * though the API schema already enforces it), so there is no shell surface and
 * no git transport modifier (`ext::`, ssh overrides) can reach the argv list.
 */
function cloneRepository(repositoryId: string, rawUrl: string): RepositorySource {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`repository ${repositoryId} has an invalid cloneUrl`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error(`repository ${repositoryId} cloneUrl must be an https://github.com URL`);
  }
  // Embedded credentials in the URL would end up in process argv; reject them.
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`repository ${repositoryId} cloneUrl must not embed credentials`);
  }
  assertSafeRepoFullName(parsed.pathname.replace(/^\//, "").replace(/\.git$/, ""));

  const workspace = mkdtempSync(path.join(tmpdir(), "patchbay-clone-"));
  try {
    runGit(["clone", "--depth", "1", "--single-branch", rawUrl, workspace], {});
  } catch (error) {
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on failure
    }
    throw error;
  }
  return {
    kind: "clone",
    cloneUrl: rawUrl,
    rootDir: workspace,
    cleanup() {
      rmSync(workspace, { recursive: true, force: true });
    },
  };
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
