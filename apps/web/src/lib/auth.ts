import "server-only";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { prisma } from "@patchbay/db";
import { forbidden, unauthorized } from "@patchbay/domain";
import { authOptions } from "./auth-options";
import { isGitHubOAuthConfigured, readSessionCookie, SESSION_COOKIE } from "./session";

export interface SessionUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
}

/**
 * Resolves the caller. When GitHub OAuth is configured, a NextAuth session
 * wins; otherwise (or when absent) the signed dev session cookie is used, so
 * local demos/tests keep working without GitHub credentials.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (isGitHubOAuthConfigured()) {
    const oauthSession = await getServerSession(authOptions);
    if (oauthSession?.user?.id) {
      return {
        id: oauthSession.user.id,
        organizationId: oauthSession.user.organizationId,
        email: oauthSession.user.email ?? "",
        name: oauthSession.user.name ?? "",
        role: oauthSession.user.role,
      };
    }
  }

  if (process.env.NODE_ENV === "production") return null;

  const cookieStore = await cookies();
  const session = await readSessionCookie(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, organizationId: true, email: true, name: true, role: true },
  });
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}

export async function requireRole(role: "ADMIN" | "MEMBER" | "VIEWER"): Promise<SessionUser> {
  const user = await requireUser();
  const roleRank: Record<SessionUser["role"], number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2 };
  if (roleRank[user.role] < roleRank[role]) throw forbidden();
  return user;
}

export async function getDemoOrganizationId(): Promise<string> {
  const user = await requireUser();
  return user.organizationId;
}
