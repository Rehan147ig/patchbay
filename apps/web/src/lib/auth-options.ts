import "server-only";
import type { NextAuthOptions } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import GithubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, type Role } from "@patchbay/domain";
import { buildAuditEvent } from "@patchbay/audit";

/**
 * NextAuth (Auth.js v4) configuration for GitHub OAuth sign-in.
 *
 * The first time a GitHub account signs in, the custom adapter creates a
 * dedicated organization for them and makes them its ADMIN — one workspace
 * per signup until team invites land. Existing users (matched by email via
 * the adapter) keep their current organization and role.
 *
 * This module is only loaded when OAuth is configured (see
 * `isGitHubOAuthConfigured` in lib/session.ts); the dev session cookie in
 * lib/session.ts remains the default auth mechanism otherwise.
 */
function createPatchbayAdapter(): Adapter {
  const base = PrismaAdapter(prisma);
  return {
    ...base,
    async createUser(data: Omit<AdapterUser, "id">) {
      const name = data.name ?? data.email.split("@")[0] ?? "New user";
      const organization = await prisma.organization.create({
        data: { name: `${name}'s workspace` },
      });
      const user = await prisma.user.create({
        data: {
          email: data.email,
          name,
          image: data.image ?? null,
          emailVerified: data.emailVerified ?? null,
          organizationId: organization.id,
          role: "ADMIN",
        },
      });

      const audit = buildAuditEvent({
        organizationId: organization.id,
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: AuditAction.ORGANIZATION_CREATED,
        entityType: "organization",
        entityId: organization.id,
        correlationId: `oauth-signup-${user.id}`,
        after: { organizationId: organization.id, userId: user.id, provider: "github" },
      });
      await prisma.auditEvent.create({
        data: {
          id: audit.id,
          organizationId: audit.organizationId,
          actorType: audit.actorType,
          actorId: audit.actorId,
          action: audit.action,
          entityType: audit.entityType,
          entityId: audit.entityId,
          correlationId: audit.correlationId,
          afterJson: audit.afterJson as never,
          createdAt: audit.createdAt,
        },
      });

      return { id: user.id, email: user.email, emailVerified: user.emailVerified };
    },
  };
}

export const authOptions: NextAuthOptions = {
  adapter: createPatchbayAdapter(),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      authorization: { params: { scope: "read:user user:email" } },
    }),
  ],
  callbacks: {
    session({ session, user }) {
      // Database session strategy: `user` is the full Prisma row loaded by the
      // adapter, so organizationId/role come along without an extra query.
      const dbUser = user as unknown as {
        id: string;
        organizationId?: string;
        role?: Role;
      };
      if (session.user) {
        session.user.id = dbUser.id;
        session.user.organizationId = dbUser.organizationId ?? "";
        session.user.role = dbUser.role ?? "VIEWER";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
};
