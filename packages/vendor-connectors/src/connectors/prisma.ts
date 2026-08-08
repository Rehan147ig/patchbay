import { defineConnector } from "../sdk";

/**
 * Prisma connector.
 *
 * Prisma breaking changes across majors:
 * - The `$transaction` API changed: the array form vs interactive form,
 *   and the `$transaction([...], { isolationLevel })` options.
 * - The generator/engine moved (prisma-client-js -> prisma-client /
 *   generator client), and the `prisma migrate` command changed.
 * - Model field types changed (BigInt, Json, Unsupported).
 */
export const prismaConnector = defineConnector({
  slug: "prisma",
  identifiers: ["prisma", "@prisma/client", "@prisma/*"],
  rules: [
    {
      changeType: "PARAMETER_REQUIRED",
      oldValue: "$transaction",
      description:
        "Prisma $transaction signatures changed across versions (array vs interactive, isolationLevel options).",
      affectedSymbols: ["$transaction", "prisma.$transaction"],
      breaking: true,
      evidence: { sdk: "prisma" },
    },
    {
      changeType: "SDK_VERSION_UPGRADE",
      oldValue: "prisma-client-js generator",
      newValue: "prisma-client generator",
      description:
        "The client generator moved (prisma-client-js -> prisma-client); schema generator blocks changed.",
      affectedSymbols: ["generator client", "prisma.schema", "schema.prisma"],
      breaking: true,
      evidence: { sdk: "prisma" },
    },
    {
      changeType: "RESPONSE_FIELD_TYPE_CHANGED",
      oldValue: "model field types",
      description:
        "Model field type handling changed (BigInt, Json, Unsupported) across Prisma majors.",
      affectedSymbols: ["prisma.model"],
      breaking: false,
      evidence: { sdk: "prisma" },
    },
  ],
  patchSuggestions: {
    $transaction: {
      replacement: "$transaction",
      description:
        "Update $transaction calls to the current API (interactive vs array form, isolationLevel).",
      confidence: 75,
    },
  },
});
