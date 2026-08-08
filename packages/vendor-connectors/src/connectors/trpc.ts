import { defineConnector } from "../sdk";

/**
 * tRPC connector.
 *
 * tRPC v10 -> v11 breaking changes:
 * - `createRouter` -> `initTRPC.create()` (the entire tRPC instance
 *   creation changed).
 * - Procedure builder (`procedure.query` etc.) stayed but input/output
 *   validation moved to zod schemas directly.
 * - Client creation changed (`createTRPCProxyClient` -> `createTRPCClient`),
 *   and the httpBatchLink API changed.
 */
export const trpcConnector = defineConnector({
  slug: "trpc",
  identifiers: ["trpc", "@trpc/*", "trpc-server"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "createRouter",
      newValue: "initTRPC.create()",
      description:
        "tRPC v11 removed createRouter; use initTRPC.create() + t.router() + t.procedure.",
      affectedSymbols: ["createRouter", "createContext", "procedure"],
      breaking: true,
      evidence: { sdk: "trpc" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "createTRPCProxyClient",
      newValue: "createTRPCClient",
      description: "The client factory was renamed and the httpBatchLink options changed in v11.",
      affectedSymbols: ["createTRPCProxyClient", "createTRPCClient", "httpBatchLink"],
      breaking: true,
      evidence: { sdk: "trpc" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "input/output validation",
      description:
        "Procedure input/output validation moved to .input(schema) with zod; legacy validation config removed.",
      affectedSymbols: ["procedure", "t.procedure"],
      breaking: true,
      evidence: { sdk: "trpc" },
    },
  ],
  patchSuggestions: {
    createRouter: {
      replacement: "initTRPC.create()",
      description:
        "Migrate createRouter to initTRPC.create() + t.router() + t.procedure patterns (v11).",
      confidence: 85,
    },
    createTRPCProxyClient: {
      replacement: "createTRPCClient",
      description: "Rename createTRPCProxyClient to createTRPCClient and update the link config.",
      confidence: 85,
    },
  },
});
