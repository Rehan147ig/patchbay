import { prisma } from "@patchbay/db";

/**
 * Dedicated system organization for global (non-org-scoped) audit events:
 * watchtower polls, job-failure records, staleness alerts. AuditEvent carries
 * an organizationId FK, so system events are recorded against this row,
 * upserted lazily on first use.
 */
const SYSTEM_ORG_ID = "org-watchtower";

let cachedOrgId: string | null = null;

export async function systemOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const org = await prisma.organization.upsert({
    where: { id: SYSTEM_ORG_ID },
    update: {},
    create: { id: SYSTEM_ORG_ID, name: "Patchbay Watchtower" },
  });
  cachedOrgId = org.id;
  return org.id;
}
