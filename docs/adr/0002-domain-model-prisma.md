# ADR-0002: Domain model - Prisma as source of truth, domain enums mirrored

Status: accepted

## Context

The domain model is large (17 entities, ~15 enums). Two consumers need the same vocabulary:
Prisma (persistence) and Zod (API validation + business logic).

## Decision

- `prisma/schema.prisma` defines entities, relations, indexes, and enum values.
- `packages/domain` re-declares enums as const objects (string literal unions) plus Zod enums
  for input validation, and re-exports Prisma-generated entity types.
- A drift test in `packages/domain` asserts every Prisma enum value exists in the domain const
  so the two can never silently diverge.

## Consequences

- Type-safe persistence-to-UI without codegen beyond Prisma.
- The drift test catches schema edits that forget the domain mirror.
