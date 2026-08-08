import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Passport.js connector.
 *
 * Passport 0.7 changes that break real apps:
 * - `passport.initialize()` / `passport.session()` middleware signatures
 *   changed for Express 4/5 compatibility (the `req.user` behavior is
 *   unchanged, but the middleware must be re-ordered correctly).
 * - Session-based auth (`passport.session()`) requires a session store
 *   configured before it; Express 5 removed the built-in MemoryStore.
 * - Serializers (`serializeUser`/`deserializeUser`) are still required for
 *   session auth; not having them now throws in newer versions.
 */
export const passportConnector = defineConnector({
  slug: "passport",
  identifiers: ["passport", "passport-*"],
  rules: [
    {
      changeType: "AUTH_CHANGE",
      oldValue: "passport.initialize()",
      newValue: "passport.initialize() (order matters)",
      description:
        "Passport 0.7 requires `passport.initialize()` and `passport.session()` mounted before routes and after `express.session()`; ordering bugs now throw.",
      affectedSymbols: ["passport.initialize", "passport.session", "passport.authenticate"],
      breaking: true,
      evidence: { sdk: "passport", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "AUTH_CHANGE",
      oldValue: "express-session MemoryStore",
      newValue: "external session store",
      description:
        "Express 5 removed the default MemoryStore; passport.session() now requires an external store (redis, connect-pg-simple, etc.).",
      affectedSymbols: ["express-session", "session"],
      breaking: true,
      evidence: { sdk: "passport", riskTag: RiskTag.AUTH },
    },
    {
      changeType: "AUTH_CHANGE",
      oldValue: "serializeUser/deserializeUser",
      description:
        "Session auth requires both serializers; missing them now throws at request time instead of failing silently.",
      affectedSymbols: ["passport.serializeUser", "passport.deserializeUser"],
      breaking: false,
      evidence: { sdk: "passport", riskTag: RiskTag.AUTH },
    },
  ],
  patchSuggestions: {
    "passport.initialize": {
      replacement: "passport.initialize()",
      description:
        "Verify passport.initialize() and passport.session() are mounted before routes and after the session middleware.",
      confidence: 82,
    },
    "passport.session": {
      replacement: "passport.session()",
      description:
        "Verify passport.session() is mounted with a configured session store (MemoryStore is gone in Express 5).",
      confidence: 82,
    },
  },
});
