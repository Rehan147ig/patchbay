import "server-only";
import { prisma } from "@patchbay/db";

/**
 * Privilege-change session rotation.
 *
 * Call whenever a user's role or org membership changes (admin demotion,
 * transfer, removal). Increments the user's sessionVersion — dev sessions
 * carrying an older version are rejected by getSessionUser — and deletes
 * all NextAuth database sessions, forcing re-authentication everywhere.
 */
export async function rotateSessions(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}
