import { defineConnector } from "../sdk";
import { RiskTag } from "@patchbay/domain";

/**
 * Express connector (v4 -> v5).
 *
 * The two breaking changes that bite most apps:
 * - `app.del` and `app.all` route registrations: `app.del` was removed
 *   (use `app.delete`), and wildcard patterns changed.
 * - The default 404/500 error handler behavior changed; async route
 *   handlers that throw now propagate automatically (no wrapper needed).
 * - `res.status(code).send()` semantics are the same, but `res.redirect()`
 *   without a status now defaults differently.
 */
export const expressConnector = defineConnector({
  slug: "express",
  identifiers: ["express"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "app.del",
      newValue: "app.delete",
      description:
        "Express 5 removed `app.del`; use `app.delete` (or the route method matching the HTTP verb).",
      affectedSymbols: ["app.del"],
      breaking: true,
      evidence: { sdk: "express" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "app.param(callback)",
      newValue: "app.param(name, callback)",
      description:
        "Express 5 requires `app.param` to be called with an explicit name; the legacy array/object forms were removed.",
      affectedSymbols: ["app.param"],
      breaking: true,
      evidence: { sdk: "express" },
    },
    {
      changeType: "ENDPOINT_REMOVED",
      oldValue: "req.param()",
      description:
        "Express 5 removed the `req.param(name)` method; read parameters from `req.params`, `req.query`, or `req.body` explicitly.",
      affectedSymbols: ["req.param"],
      breaking: true,
      evidence: { sdk: "express" },
    },
    {
      changeType: "WEBHOOK_CHANGE",
      oldValue: "app.use('/api', router)",
      description:
        "Express 5 changed path matching for `app.use` with a path prefix + router: wildcards must be named (`/*splat`), not `*`.",
      affectedSymbols: ["app.use"],
      breaking: false,
      evidence: { sdk: "express", riskTag: RiskTag.WEBHOOK },
    },
  ],
  patchSuggestions: {
    "app.del": {
      replacement: "app.delete",
      description: "Replace `app.del` with `app.delete` (Express 5 removed the alias).",
      confidence: 98,
    },
    "req.param": {
      replacement: "req.params",
      description:
        "Replace `req.param(name)` with `req.params[name]` (route params), `req.query[name]`, or `req.body[name]`.",
      confidence: 90,
    },
    "app.param": {
      replacement: "app.param(name, callback)",
      description:
        "Update `app.param` calls to the `(name, callback)` signature required by Express 5.",
      confidence: 88,
    },
  },
});
