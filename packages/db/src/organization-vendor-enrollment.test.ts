import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./client";
import { ensureProbeRole, probeUrl } from "./test-probe";

/**
 * REAL-database integration tests for OrganizationVendorEnrollment (P0-1).
 *
 * A catalog Vendor row must never carry one tenant's credential: these tests
 * prove the enrollment join holds keys per (organization, vendor), that the
 * compound unique blocks duplicates, that the migration backfill preserves
 * legacy hashes, and that RLS hides one org's enrollments from another.
 * Skipped automatically when no database is reachable.
 */

const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

const suffix = randomUUID().slice(0, 8);
const orgA = `org-enr-a-${suffix}`;
const orgB = `org-enr-b-${suffix}`;
const vendorSlug = `enroll-vendor-${suffix}`;
let vendorId = "";

/**
 * Mirrors packages/db/prisma/migrations/20260907000000_vendor_enrollment/migration.sql.
 * Kept as executable SQL (not a copy of application logic) so this test runs
 * the same statement shape the migration applies, including idempotency.
 */
const BACKFILL_SQL = `
INSERT INTO "OrganizationVendorEnrollment"
  ("id", "organizationId", "vendorId", "agentKeyHash", "agentKeyHashPrevious", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "Vendor"."organizationId",
  "Vendor"."id",
  "Vendor"."agentKeyHash",
  "Vendor"."agentKeyHashPrevious",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Vendor"
WHERE "Vendor"."organizationId" IS NOT NULL
  AND "Vendor"."agentKeyHash" IS NOT NULL
ON CONFLICT ("organizationId", "vendorId") DO NOTHING`;

let probe: PrismaClient | null = null;

async function asOrg<T>(organizationId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
  if (!probe) throw new Error("probe client not initialized");
  return probe.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_organization_id = '${organizationId}'`);
    return fn(tx as PrismaClient);
  });
}

(reachable ? describe : describe.skip)("OrganizationVendorEnrollment (real database)", () => {
  beforeAll(async () => {
    await ensureProbeRole();
    probe = new PrismaClient({ datasourceUrl: probeUrl() });
    await probe.$queryRaw`SELECT 1`;
    await prisma.organization.createMany({
      data: [
        { id: orgA, name: "enrollment-org-a" },
        { id: orgB, name: "enrollment-org-b" },
      ],
    });
    const vendor = await prisma.vendor.create({
      data: {
        slug: vendorSlug,
        name: "Enrollment Vendor",
        category: "Test",
        organizationId: null,
      },
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await prisma.organizationVendorEnrollment.deleteMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await probe?.$disconnect();
    await prisma.$disconnect();
  });

  it("enforces one enrollment per (organization, vendor)", async () => {
    await prisma.organizationVendorEnrollment.create({
      data: { organizationId: orgA, vendorId, agentKeyHash: "hash-a", status: "ACTIVE" },
    });
    await expect(
      prisma.organizationVendorEnrollment.create({
        data: { organizationId: orgA, vendorId, agentKeyHash: "hash-a2", status: "ACTIVE" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("lets two organizations enroll the same shared vendor independently", async () => {
    await prisma.organizationVendorEnrollment.create({
      data: { organizationId: orgB, vendorId, agentKeyHash: "hash-b", status: "ACTIVE" },
    });
    const rows = await prisma.organizationVendorEnrollment.findMany({
      where: { vendorId },
      orderBy: { organizationId: "asc" },
    });
    expect(rows.map((r) => [r.organizationId, r.agentKeyHash])).toEqual([
      [orgA, "hash-a"],
      [orgB, "hash-b"],
    ]);
  });

  it("resolves missing enrollments to null (agent mode disabled)", async () => {
    const missing = await prisma.organizationVendorEnrollment.findUnique({
      where: { organizationId_vendorId: { organizationId: "org-nope", vendorId } },
    });
    expect(missing).toBeNull();
  });

  it("hides one org's enrollments from another org under RLS", async () => {
    await asOrg(orgB, async (tx) => {
      expect(await tx.organizationVendorEnrollment.findMany({ where: { vendorId } })).toEqual([
        expect.objectContaining({ organizationId: orgB, agentKeyHash: "hash-b" }),
      ]);
      // Cross-tenant point read through the compound key returns nothing:
      // the key embeds the caller's org, so there is no oracle.
      expect(
        await tx.organizationVendorEnrollment.findUnique({
          where: { organizationId_vendorId: { organizationId: orgA, vendorId } },
        }),
      ).toBeNull();
    });
  });

  it("rejects cross-tenant enrollment writes with 42501", async () => {
    await asOrg(orgB, async (tx) => {
      await expect(
        tx.organizationVendorEnrollment.create({
          data: { organizationId: orgA, vendorId, agentKeyHash: "evil", status: "ACTIVE" },
        }),
      ).rejects.toThrow(/42501|row-level security/);
    });
  });

  it("backfills legacy per-org vendor hashes into enrollments, idempotently", async () => {
    const legacySlug = `enroll-legacy-${suffix}`;
    const legacy = await prisma.vendor.create({
      data: {
        slug: legacySlug,
        name: "Legacy Vendor",
        category: "Test",
        organizationId: orgA,
        agentKeyHash: "legacy-hash",
        agentKeyHashPrevious: "legacy-prev",
      },
    });
    try {
      await prisma.$executeRawUnsafe(BACKFILL_SQL);
      const row = await prisma.organizationVendorEnrollment.findUnique({
        where: { organizationId_vendorId: { organizationId: orgA, vendorId: legacy.id } },
      });
      expect(row).toMatchObject({
        agentKeyHash: "legacy-hash",
        agentKeyHashPrevious: "legacy-prev",
        status: "ACTIVE",
      });
      // Rerun converges: still exactly one row.
      await prisma.$executeRawUnsafe(BACKFILL_SQL);
      expect(
        await prisma.organizationVendorEnrollment.count({
          where: { organizationId: orgA, vendorId: legacy.id },
        }),
      ).toBe(1);
    } finally {
      await prisma.organizationVendorEnrollment.deleteMany({
        where: { organizationId: orgA, vendorId: legacy.id },
      });
      await prisma.vendor.delete({ where: { id: legacy.id } });
    }
  });
});
