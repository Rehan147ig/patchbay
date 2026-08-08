import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Clerk connector.
 *
 * Clerk frontend/backend SDK breaking changes:
 * - The frontend API client restructured: `Clerk` -> `clerkClient`,
 *   `useUser()`/`useAuth()` hooks moved packages.
 * - `@clerk/nextjs` changed middleware/session APIs across majors
 *   (auth() -> clerkClient()).
 * - Webhook verification (`svix` payload) is now standard; event types
 *   changed (user.created, session.ended).
 */
export const clerkConnector = defineConnector({
  slug: "clerk",
  identifiers: ["clerk", "@clerk/*", "clerk-sdk-node"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "auth()",
      newValue: "clerkClient()",
      description:
        "@clerk/nextjs restructured: auth() middleware helper changed across majors; use clerkClient() for server calls.",
      affectedSymbols: ["auth", "clerkClient", "getAuth"],
      breaking: true,
      evidence: { sdk: "clerk", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "webhook event types",
      description:
        "Clerk webhook event types changed (user.created, session.ended, organizationMembership.created).",
      affectedSymbols: ["clerk.webhooks", "webhooks"],
      breaking: true,
      evidence: { sdk: "clerk", riskTag: RiskTag.WEBHOOK },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "users.getUser",
      description:
        "clerk-sdk-node renamed user/session methods across majors (getUserList, getSessionList).",
      affectedSymbols: ["clerkClient.users", "users.getUser"],
      breaking: false,
      evidence: { sdk: "clerk" },
    },
  ],
  patchSuggestions: {
    auth: {
      replacement: "clerkClient",
      description:
        "Replace auth() server-side session reads with clerkClient() (current @clerk/nextjs API).",
      confidence: 82,
    },
  },
});
