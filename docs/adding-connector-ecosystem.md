# Adding a new ecosystem connector (NuGet / Go / Maven / RubyGems)

Current SDK coverage: `npm` (JS/TS) + `pypi` (Python) + `openapi` + `github-releases` (`terraform`). To scale Patch to `NuGet` (C#), `Go`, `Maven` (Java), `RubyGems` without forking the core:

## 1. Define the connector

`packages/vendor-connectors/src/connectors/<slug>.ts`:

```ts
import { defineConnector } from "../sdk";
export const myConnector = defineConnector({
  slug: "my-nuget-package",
  identifiers: ["My.Package"], // NuGet package id / Go module / Maven coord / gem name
  rules: [
    {
      changeType: "METHOD_RENAMED",
      oldValue: "OldClient.OldMethod",
      newValue: "NewClient.NewMethod",
      affectedSymbols: ["OldMethod"],
      breaking: true,
      evidence: { sdk: "my-nuget-package" },
    },
  ],
  patchSuggestions: { OldMethod: { replacement: "NewMethod", description: "...", confidence: 85 } },
});
```

Allowed `ecosystem` values in `packages/vendor-connectors/src/capabilities.ts:28`: `npm | pypi | openapi | github-releases`. Add `"nuget" | "go" | "maven" | "rubygems"` there and handle in `baseline()` / `certified()` — the graph layer (`packages/repo-analysis`) already tracks `RepositoryDependency` generically; only `lockfile.ts` needs a new parser (`packages/repo-analysis/src/lockfile.ts:1`).

## 2. Lockfile + manifest parsing

- **NuGet**: parse `packages.lock.json` / `*.csproj` `<PackageReference>` (already have `lockfile.test.ts` harness)
- **Go**: parse `go.mod` (`require my/module v1.2.3`)
- **Maven**: parse `pom.xml` `<dependency>`
- **RubyGems**: parse `Gemfile.lock`

Add `parse<Lang>Manifest` in `packages/repo-analysis/src/python.ts:54` style (strip extras/markers) and wire into `packages/repo-analysis/src/analyzer.ts:1` `trackSet`.

## 3. Private ingest (Internal SDK)

No new code — platform teams push private SDK events via `POST /api/vendors/:slug/events` with `pb_agent_*` (`docs/vendor-agent-ingest.md:1`). Private `Vendor.organizationId != null` rows are filtered `WHERE organizationId IN (NULL, callerOrg)` (`packages/db/src/org-scope.ts:62`) so catalog + private coexist.

## 4. Certification

Follow `docs/connector-certification.md:1` — add fixture `fixtures/repositories/<slug>-legacy/`, corpus pair in `eval-corpus.ts`, then `pnpm test:corpus` must be green before `CAPABILITY_REGISTRY` level goes `ASSESS → DRAFT_PR`.

Do not claim `DRAFT_PR` until `checkCertifiedPatchCoverage` passes — CI enforces it.
