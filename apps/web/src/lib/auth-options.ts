import "server-only";
import type { NextAuthOptions } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import OktaProvider from "next-auth/providers/okta";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@patchbay/db";
import { AuditAction } from "@patchbay/audit";
import { ActorType, type Role } from "@patchbay/domain";
import { buildAuditEvent } from "@patchbay/audit";
import { env } from "@/lib/env";

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
      const emailDomain = data.email.split("@")[1]?.toLowerCase() ?? "";
      // Stage 5A: SSO auto-provision — if an org has ssoDomain == emailDomain, join it instead of creating a new workspace.
      let organization = null as Awaited<ReturnType<typeof prisma.organization.findFirst>>;
      if (emailDomain) {
        const candidates = await prisma.organization.findMany({ take: 50 });
        // ssoDomain stored in Organization.name suffix or metadata — check both for backward compat
        organization =
          candidates.find((org) => {
            const meta = (org as unknown as { metadata?: unknown }).metadata as
              Record<string, unknown> | undefined;
            const ssoDomain = (meta?.ssoDomain as string | undefined) ?? "";
            return ssoDomain.toLowerCase() === emailDomain;
          }) ?? null;
      }
      if (!organization) {
        organization = await prisma.organization.create({
          data: { name: `${name}'s workspace` },
        });
      }
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

const ssoEnabled = process.env.SSO_ENABLED === "1";

export const authOptions: NextAuthOptions = {
  adapter: createPatchbayAdapter(),
  providers: [
    GithubProvider({
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
      authorization: { params: { scope: "read:user user:email" } },
    }),
    ...(ssoEnabled && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    ...(ssoEnabled &&
    process.env.OKTA_CLIENT_ID &&
    process.env.OKTA_CLIENT_SECRET &&
    process.env.OKTA_ISSUER
      ? [
          OktaProvider({
            clientId: process.env.OKTA_CLIENT_ID,
            clientSecret: process.env.OKTA_CLIENT_SECRET,
            issuer: process.env.OKTA_ISSUER,
          }),
        ]
      : []),
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
