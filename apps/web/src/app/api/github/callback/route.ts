import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@patchbay/db";
import { requireUser } from "@/lib/auth";
import { fetchGitHubInstallationInfo } from "@patchbay/git-provider";
import { GITHUB_INSTALL_STATE_COOKIE, verifyGitHubInstallState } from "@/lib/github-install-state";

/**
 * GET /api/github/callback?installation_id=...&setup_action=install
 * GitHub redirects here after App installation.
 */
export async function GET(request: NextRequest) {
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
    const installation = await fetchGitHubInstallationInfo(installationId);
    await prisma.gitHubInstallation.upsert({
      where: { installationId },
      update: { organizationId: user.organizationId, suspendedAt: null },
      create: {
        organizationId: user.organizationId,
        installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        repositorySelection: installation.repositorySelection,
        permissions: installation.permissions,
      },
    });

    const response = NextResponse.redirect(new URL("/settings/github?installed=true", request.url));
    response.cookies.set(GITHUB_INSTALL_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
