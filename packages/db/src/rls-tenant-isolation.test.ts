import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./client";
import { ensureProbeRole, probeUrl } from "./test-probe";

/**
 * REAL-database negative cross-tenant suite for RLS (WP11, spec §4.3).
 *
 * Mocks can assert that queries CARRY organizationId, but only Postgres can
 * prove a foreign tenant CANNOT READ them. Every test here sets
 * app.current_organization_id inside an interactive transaction (same
 * connection for SET LOCAL + queries) and attempts cross-tenant access.
 *
 * Skipped automatically when no database is reachable. The migrations under
 * test must be applied (`pnpm db:migrate`).
 */

const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

const suffix = randomUUID().slice(0, 8);
const orgA = `org-rls-a-${suffix}`;
const orgB = `org-rls-b-${suffix}`;

let probe: PrismaClient | null = null;

/** Run fn with the RLS session variable pinned (same pooled connection). */
async function asOrg<T>(organizationId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  if (!probe) throw new Error("probe client not initialized");
  return probe.$transaction(async (tx) => {
    // SET LOCAL takes no bind parameters; the id is generated hex, never input.
    await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${organizationId}'`);
    return fn(tx as PrismaClient);
  });
}

async function tablesWithOrgColumn(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public'
    WHERE c.column_name = 'organizationId'
      AND t.table_type = 'BASE TABLE'
  `;
  return rows.map((row) => row.table_name).sort();
}

async function tablesWithTenantPolicy(): Promise<string[]> {
  // Migration convention: CREATE POLICY "<Table>_tenant_isolation".
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE '%_tenant_isolation'
  `;
  return rows.map((row) => row.tablename).sort();
}

(reachable ? describe : describe.skip)("RLS tenant isolation (real database)", () => {
  beforeAll(async () => {
    await ensureProbeRole();
    probe = new PrismaClient({ datasourceUrl: probeUrl() });
    await probe.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    // Break-glass cleanup (same pattern as worm-db.test.ts): the WORM trigger
    // blocks audit deletes, so disable it around test-row removal and
    // re-enable unconditionally. Test orgs cascade everything else.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AuditEvent" DISABLE TRIGGER audit_event_worm_trigger`,
    );
    try {
      await prisma.auditEvent.deleteMany({ where: { id: { contains: suffix } } });
      await prisma.auditEvent.deleteMany({ where: { entityId: `rls-${suffix}` } });
      await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "AuditEvent" ENABLE TRIGGER audit_event_worm_trigger`,
      );
    }
    await probe?.$disconnect();
    await prisma.$disconnect();
  });

  it("covers every organization-owned table with a tenant_isolation policy", async () => {
    const owned = await tablesWithOrgColumn();
    expect(owned.length).toBeGreaterThan(0);
    const covered = await tablesWithTenantPolicy();
    // Deliberate exemptions (mirrors ORG_SCOPE_EXEMPT_MODELS in org-scope.ts):
    // User is session-bound, WebhookDelivery is a global receiver, and
    // Vendor/ContractSource are MIXED catalog/private models whose NULL-org
    // rows an equality policy would hide from every tenant.
    const exempt = ["User", "WebhookDelivery", "Vendor", "ContractSource"];
    const missing = owned.filter((table) => !covered.includes(table) && !exempt.includes(table));
    expect(missing, `tables with organizationId lacking RLS: ${missing.join(", ")}`).toEqual([]);
  });

  it("blocks cross-tenant reads across representative models", async () => {
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: "rls-a" },
        { id: orgB, name: "rls-b" },
      ],
    });

    const repoId = `repo-rls-${suffix}`;
    const policyId = `pol-rls-${suffix}`;
    await asOrg(orgA, async (tx) => {
      await tx.repository.create({
        data: {
          id: repoId,
          organizationId: orgA,
          provider: "GITHUB",
          externalId: `ext-${suffix}`,
          name: "victim",
          fullName: `victim/${suffix}`,
          languageProfile: {},
          metadata: {},
        },
      });
      await tx.policy.create({
        data: { id: policyId, organizationId: orgA, name: `rls-${suffix}`, definitionJson: {} },
      });
      await tx.capabilityGate.create({
        data: { organizationId: orgA, vendorSlug: "stripe", level: "DRAFT_PR" },
      });
      await tx.validationProfile.create({
        data: {
          organizationId: orgA,
          name: "default",
          commandIds: ["pnpm-install-frozen"],
          image: "node:20-slim",
          timeoutMs: 120_000,
        },
      });
      await tx.deadLetterJob.create({
        data: {
          organizationId: orgA,
          jobType: "create-pr",
          idempotencyKey: `dlq:create-pr:rls-${suffix}`,
          payload: {},
          payloadHash: "0".repeat(64),
          attemptsMade: 3,
        },
      });
      await tx.notification.create({
        data: { organizationId: orgA, type: "PR_CREATED", title: "rls" },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: orgA,
          actorType: "SYSTEM",
          actorId: null,
          action: "rls.integration_test",
          entityType: "test",
          entityId: `rls-${suffix}`,
          correlationId: null,
        },
      });
    });

    // Tenant B sees NOTHING of A's rows — list and point reads alike.
    await asOrg(orgB, async (tx) => {
      expect(await tx.repository.findMany({ where: { organizationId: orgA } })).toEqual([]);
      expect(await tx.repository.findUnique({ where: { id: repoId } })).toBeNull();
      expect(await tx.policy.findUnique({ where: { id: policyId } })).toBeNull();
      expect(await tx.capabilityGate.findMany({ where: { organizationId: orgA } })).toEqual([]);
      expect(await tx.validationProfile.findMany({ where: { organizationId: orgA } })).toEqual([]);
      expect(await tx.deadLetterJob.findMany({ where: { organizationId: orgA } })).toEqual([]);
      expect(await tx.notification.findMany({ where: { organizationId: orgA } })).toEqual([]);
      expect(await tx.auditEvent.findMany({ where: { organizationId: orgA } })).toEqual([]);
    });

    // ...while tenant A still reads its own rows (policy is selective, not blank).
    await asOrg(orgA, async (tx) => {
      expect(await tx.repository.findUnique({ where: { id: repoId } })).not.toBeNull();
      expect(await tx.deadLetterJob.findMany({ where: { organizationId: orgA } })).toHaveLength(1);
    });
  });

  it("rejects cross-tenant writes (WITH CHECK) with 42501", async () => {
    // Prisma surfaces Postgres 42501 wrapped in the message (no .code prop).
    await asOrg(orgB, async (tx) => {
      // Insert claiming org A while authenticated as B.
      await expect(
        tx.repository.create({
          data: {
            organizationId: orgA,
            provider: "GITHUB",
            externalId: `ext-evil-${suffix}`,
            name: "evil",
            fullName: `evil/${suffix}`,
            languageProfile: {},
            metadata: {},
          },
        }),
      ).rejects.toThrow(/42501|row-level security/);
      await expect(
        tx.deadLetterJob.create({
          data: {
            organizationId: orgA,
            jobType: "create-pr",
            idempotencyKey: `dlq:create-pr:evil-${suffix}`,
            payload: {},
            payloadHash: "1".repeat(64),
            attemptsMade: 1,
          },
        }),
      ).rejects.toThrow(/42501|row-level security/);
    });
  });

  it("makes cross-tenant updates and deletes affect zero rows", async () => {
    await asOrg(orgB, async (tx) => {
      const updated = await tx.repository.updateMany({
        where: { organizationId: orgA },
        data: { name: "hijacked" },
      });
      expect(updated.count).toBe(0);
      const deleted = await tx.policy.deleteMany({ where: { organizationId: orgA } });
      expect(deleted.count).toBe(0);
    });
    // A's data is byte-identical after the attempt.
    await asOrg(orgA, async (tx) => {
      const repo = await tx.repository.findFirst({ where: { organizationId: orgA } });
      expect(repo?.name).toBe("victim");
      expect(await tx.policy.count({ where: { organizationId: orgA } })).toBe(1);
    });
  });
});
