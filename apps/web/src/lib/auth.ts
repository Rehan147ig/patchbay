import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@patchbay/db";
import { forbidden, unauthorized } from "@patchbay/domain";
import { readSessionCookie } from "./session";

export interface SessionUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: "ADMIN" | "MEMBER" | "VIEWER";
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const session = await readSessionCookie(cookieStore.get("patchbay_session")?.value);
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
