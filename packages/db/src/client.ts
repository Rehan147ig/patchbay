import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton. Kept alive across HMR in Next.js dev; safe to import anywhere.
 */
const globalForPrisma = globalThis as unknown as { patchbayPrisma?: PrismaClient };

export const prisma = globalForPrisma.patchbayPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.patchbayPrisma = prisma;
}
