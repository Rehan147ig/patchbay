import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType } from "@patchbay/domain";
import { countActiveRepositories, getEffectivePlan } from "@/lib/billing";
import { repositoryCapacity } from "@patchbay/billing";
import { enqueue, JobType } from "@patchbay/queue";
import { requireUser } from "@/lib/auth";
import {
  fetchGitHubInstallationInfoFromStore,
  listInstallationRepositoriesFromStore,
} from "@patchbay/git-provider";
import { getSecretStore } from "@patchbay/env";
import { writeAuditEvent } from "@/lib/api";
import { GITHUB_INSTALL_STATE_COOKIE, verifyGitHubInstallState } from "@/lib/github-install-state";

/**
 * GET /api/github/callback?installation_id=...&setup_action=install
 * GitHub redirects here after App installation.
 *
 * Binding an installation to an organization is a security-relevant mutation:
 * it is created (never re-bound) atomically and audited. A concurrent admin of
 * a different org completing the same NEW installation loses the race cleanly
 * via the unique constraint instead of stealing the binding through upsert.
 *
 * PLG activation (#7): on FIRST binding, auto-registers every repository the
 * installation can access (respecting plan capacity) and enqueues an initial
 * scan for each — the dashboard is already working when the user lands.
 */
export async function GET(request: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const user = await requireUser();
    const installationIdStr = request.nextUrl.searchParams.get("installation_id");
    const setupAction = request.nextUrl.searchParams.get("setup_action");
    const state = request.nextUrl.searchParams.get("state");

    if (!installationIdStr || (setupAction !== "install" && setupAction !== "update")) {
      return NextResponse.redirect(new URL("/settings/github?error=invalid_callback", request.url));
    }
    const stateCookie = request.cookies.get(GITHUB_INSTALL_STATE_COOKIE)?.value;
    const installState =
      state && stateCookie && state === stateCookie ? verifyGitHubInstallState(state) : null;
    if (
      !installState ||
      installState.userId !== user.id ||
      installState.organizationId !== user.organizationId
    ) {
      return NextResponse.redirect(
        new URL("/settings/github?error=invalid_install_state", request.url),
      );
    }

    const installationId = parseInt(installationIdStr, 10);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      return NextResponse.redirect(
        new URL("/settings/github?error=invalid_installation_id", request.url),
      );
    }

    const existing = await prisma.gitHubInstallation.findUnique({ where: { installationId } });
    if (existing && existing.organizationId !== user.organizationId) {
      return NextResponse.redirect(
        new URL("/settings/github?error=installation_already_bound", request.url),
      );
    }
    const info = await fetchGitHubInstallationInfoFromStore(installationId, getSecretStore());

    let registeredCount = 0;
    if (!existing) {
      try {
        await prisma.gitHubInstallation.create({
          data: {
            organizationId: user.organizationId,
            installationId,
            accountLogin: info.accountLogin,
            accountType: info.accountType,
            repositorySelection: info.repositorySelection,
            permissions: info.permissions,
          },
        });
      } catch (error) {
        // Lost the creation race to another org: never steal the binding.
        if (!String(error).includes("Unique constraint")) throw error;
        return NextResponse.redirect(
          new URL("/settings/github?error=installation_already_bound", request.url),
        );
      }
      await writeAuditEvent({
        organizationId: user.organizationId,
        actorType: ActorType.USER,
        actorId: user.id,
        action: AuditAction.GITHUB_INSTALLATION_SYNCED,
        entityType: "gitHubInstallation",
        entityId: String(installationId),
        correlationId,
        after: {
          accountLogin: info.accountLogin,
          repositorySelection: info.repositorySelection,
          bound: true,
        },
      });

      // PLG activation: auto-register accessible repos (capacity-respecting)
      // and enqueue initial scans so the dashboard is alive immediately.
      const plan = await getEffectivePlan(user.organizationId);
      const activeCount = await countActiveRepositories(user.organizationId);
      const capacityResult = repositoryCapacity(plan.tier, activeCount);
      const remaining = capacityResult.remaining ?? 0;
      if (remaining > 0) {
        try {
          const repos = await listInstallationRepositoriesFromStore(
            installationId,
            getSecretStore(),
          );
          for (const repo of repos.slice(0, remaining)) {
            const created = await prisma.repository.upsert({
              where: {
                organizationId_externalId: {
                  organizationId: user.organizationId,
                  externalId: repo.externalId,
                },
              },
              update: { metadata: { installationId, provider: "GITHUB" } },
              create: {
                organizationId: user.organizationId,
                externalId: repo.externalId,
                name: repo.fullName.split("/")[1] ?? repo.fullName,
                fullName: repo.fullName,
                provider: "GITHUB",
                status: "ACTIVE",
                defaultBranch: repo.defaultBranch || "main",
                languageProfile: { typescript: true },
                metadata: { installationId, provider: "GITHUB" },
              },
            });
            const scan = await prisma.repositoryScan.create({
              data: {
                organizationId: user.organizationId,
                repositoryId: created.id,
                commitSha: "pending",
                status: "QUEUED",
              },
            });
            await enqueue(JobType.SCAN_REPOSITORY, {
              repositoryId: created.id,
              scanId: scan.id,
              correlationId,
            });
            registeredCount += 1;
          }
          await writeAuditEvent({
            organizationId: user.organizationId,
            actorType: ActorType.USER,
            actorId: user.id,
            action: AuditAction.GITHUB_INSTALLATION_SYNCED,
            entityType: "gitHubInstallation",
            entityId: String(installationId),
            correlationId,
            after: {
              autoRegistered: registeredCount,
              availableRepos: repos.length,
              capacityCap: capacityResult.cap,
            },
          });
        } catch {
          // Best-effort activation: manual connect remains available.
        }
      }
    } else {
      await prisma.gitHubInstallation.update({
        where: { installationId },
        data: { suspendedAt: null, ...installationRefresh(info) },
      });
    }

    const response = NextResponse.redirect(new URL("/settings/github?installed=true", request.url));
    response.cookies.set(GITHUB_INSTALL_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

function installationRefresh(info: {
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  permissions: unknown;
}): Record<string, unknown> {
  return {
    accountLogin: info.accountLogin,
    accountType: info.accountType,
    repositorySelection: info.repositorySelection,
    permissions: info.permissions,
  };
}
