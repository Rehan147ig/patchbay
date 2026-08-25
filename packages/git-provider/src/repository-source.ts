import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSafeRepoFullName, runGit } from "./git-safe";

/**
 * Shared repository-source resolution (scan / graph-index / validation /
 * planning all consume this): where a repository's source lives and how to get
 * a disposable copy of it.
 *
 * - fixture: local filesystem copy (demo/offline), no checkout
 * - github: exact-HEAD checkout through a GitHub App installation token
 * - clone: credential-free https://github.com URL, shallow argv clone
 *
 * The DB lookup for installation ownership is injected (`deps`) so this module
 * stays DB-free per the architecture rules; callers bind their own Prisma.
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
      cloneUrl: string;
      rootDir: string;
      cleanup(): void;
    };

export interface RepositorySourceRepository {
  id: string;
  provider: string;
  fullName: string | null;
  defaultBranch: string | null;
  organizationId: string;
  metadata: unknown;
}

export interface RepositorySourceDeps {
  /** Returns the owning organization id for a GitHub App installation, or null. */
  findInstallationOrganizationId(installationId: number): Promise<string | null>;
  /** Creates an installation-scoped provider for exact-SHA checkout. */
  createInstallationProvider(input: {
    installationId: number;
    repositoryFullName: string;
  }): Promise<{
    resolveHeadSha(baseBranch?: string): Promise<string>;
    checkout(input: {
      sha: string;
      baseBranch?: string;
      repositoryFullName?: string;
    }): Promise<{ workspaceDir: string }>;
  }>;
  /** Hardened fixture-name -> absolute directory resolution (containment-checked). */
  resolveFixtureDir(name: string): string;
}

/**
 * Tenant boundary: an installation id found in repository metadata is only
 * usable when bound to the SAME organization as the repository row.
 */
export async function assertInstallationBelongsToOrganization(
  installationId: number,
  organizationId: string,
  deps: RepositorySourceDeps,
): Promise<void> {
  const owner = await deps.findInstallationOrganizationId(installationId);
  if (owner !== organizationId) {
    throw new Error(
      `installation ${installationId} is not bound to organization ${organizationId}`,
    );
  }
}

export async function resolveRepositorySource(
  repository: RepositorySourceRepository,
  deps: RepositorySourceDeps,
): Promise<RepositorySource> {
  const fixture = fixtureOf(repository.metadata);
  if (fixture) {
    return {
      kind: "fixture",
      fixture,
      rootDir: deps.resolveFixtureDir(fixture),
      cleanup() {},
    };
  }

  const installationId = installationIdOf(repository.metadata);
  if (repository.provider === "GITHUB" && installationId) {
    if (!repository.fullName) {
      throw new Error(`repository ${repository.id} has no fullName for GitHub checkout`);
    }
    await assertInstallationBelongsToOrganization(installationId, repository.organizationId, deps);
    const provider = await deps.createInstallationProvider({
      installationId,
      repositoryFullName: repository.fullName,
    });
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
  // Non-default ports would send the clone to whatever listens on
  // github.com:<port>; only the standard HTTPS port is acceptable.
  if (parsed.port !== "" && parsed.port !== "443") {
    throw new Error(`repository ${repositoryId} cloneUrl must use the default https port`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(`repository ${repositoryId} cloneUrl must not embed credentials`);
  }
  assertSafeRepoFullName(parsed.pathname.replace(/^\//, "").replace(/\.git$/, ""));

  // Canonicalize: origin + pathname drops query strings, fragments, and any
  // userinfo/port surprises, so git only ever sees a clean repo URL.
  const canonicalUrl = `${parsed.origin}${parsed.pathname}`;

  const workspace = mkdtempSync(path.join(tmpdir(), "patchbay-clone-"));
  try {
    runGit(["clone", "--depth", "1", "--single-branch", canonicalUrl, workspace], {});
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
    cloneUrl: canonicalUrl,
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
