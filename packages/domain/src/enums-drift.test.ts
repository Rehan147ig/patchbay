import * as PrismaClientModule from "@prisma/client";
import { ALL_ENUMS } from "./enums";
import { describe, expect, it } from "vitest";

/**
 * Guards against drift between prisma/schema.prisma enums and the domain const objects
 * that the application actually uses.
 *
 * Direction A: every domain enum value must exist in the generated Prisma client
 * (catches schema edits that dropped values).
 * Direction B: every enum-like member of the Prisma namespace must have a domain mirror
 * (catches new schema enums nobody mirrored).
 */

const PRISMA_INTERNAL_MEMBERS = new Set([
  "PrismaClient",
  "Prisma",
  "ModelName",
  "prismaVersion",
  "PrismaPromise",
  "defineExtension",
  "getExtensionContext",
  "TransactionIsolationLevel",
  "SortOrder",
  "QueryMode",
  "NullsOrder",
]);

describe("enum drift guard: domain -> prisma", () => {
  for (const [enumName, values] of Object.entries(ALL_ENUMS)) {
    const prismaEnum = (PrismaClientModule as Record<string, unknown>)[enumName];
    it(`Prisma client exports enum ${enumName}`, () => {
      expect(
        prismaEnum,
        `Prisma.${enumName} missing - schema edited without domain update?`,
      ).toBeDefined();
    });
    for (const value of Object.values(values)) {
      it(`Prisma.${enumName} contains ${String(value)}`, () => {
        const member = (prismaEnum as Record<string, unknown>)[String(value)];
        expect(member, `Prisma.${enumName} dropped ${String(value)}`).toBeDefined();
      });
    }
  }
});

describe("enum drift guard: prisma -> domain", () => {
  for (const [prismaName, member] of Object.entries(PrismaClientModule)) {
    if (PRISMA_INTERNAL_MEMBERS.has(prismaName)) continue;
    if (prismaName.endsWith("ScalarFieldEnum")) continue;
    if (!looksLikeEnum(member)) continue;
    it(`Prisma enum ${prismaName} has a domain mirror`, () => {
      const mirror = (ALL_ENUMS as Record<string, unknown>)[prismaName];
      expect(
        mirror,
        `Prisma enum ${prismaName} is not mirrored in packages/domain/src/enums.ts`,
      ).toBeDefined();
    });
  }
});

function looksLikeEnum(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const values = Object.values(value);
  if (values.length === 0) return false;
  return values.every((v) => typeof v === "string");
}
