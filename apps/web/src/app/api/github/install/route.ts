import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createGitHubInstallState, GITHUB_INSTALL_STATE_COOKIE } from "@/lib/github-install-state";

export async function GET(request: Request) {
  try {
    const user = await requireRole("ADMIN");
    const appSlug = process.env.GITHUB_APP_SLUG;
    if (!appSlug) {
      return NextResponse.redirect(
        new URL("/settings/github?error=app_not_configured", request.url),
      );
    }
    const state = createGitHubInstallState(user.id, user.organizationId);
    const target = new URL(`https://github.com/apps/${appSlug}/installations/new`);
    target.searchParams.set("state", state);
    const response = NextResponse.redirect(target);
    response.cookies.set(GITHUB_INSTALL_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
