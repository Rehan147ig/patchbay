# Release Watchtower

## The Detection Brain for Patchbay

Patchbay's AI should never be asked, "Did something change somewhere on the internet?" That is
unbounded, unverifiable, and expensive. Release Watchtower is the deterministic intelligence system
that answers four concrete questions before an AI patch agent is allowed to run:

1. What vendor release, API change, or deprecation was published?
2. Is the evidence authentic, complete, and new?
3. Which customer repositories use the affected product and version?
4. Which exact source locations may be affected?

Only after these questions have evidence-backed answers may the Patch Generation Agent propose a
code change. Watchtower is therefore the product's nervous system: global vendor intelligence in,
tenant-specific verified remediation opportunities out.

## Product Promise

> When an API or SDK changes, Patchbay identifies the affected customer code before the change
> becomes an incident, then produces a governed, validated pull request.

Patchbay does not promise knowledge of undisclosed vendor changes. It detects a change as soon as a
trusted external signal exists. Vendors can provide an earlier signal through a signed release
manifest or prerelease channel.

## Core Principles

- **Evidence first.** A model may classify and explain evidence; it never invents a release.
- **Global release, local impact.** One upstream release is stored once. Customer impact is derived
  separately for every organization and repository.
- **Cheap gates before expensive reasoning.** Version and dependency matching happen before AST
  scans; AST scans happen before AI calls; validation happens before PRs.
- **Idempotent everywhere.** Repeated polls, retries, and webhook delivery replay must produce one
  release record and one impact work item per relevant repository revision.
- **No broad repo access.** The detection plane reads dependency metadata and pre-indexed usage
  facts. The remediation plane fetches only files necessary for an approved job.
- **Provenance is a feature.** Every generated PR must link back to release evidence, version
  comparison, affected usages, policy decision, and validation result.

## System Architecture

```text
                    External change signals
  npm registry | GitHub releases | OpenAPI | changelog | vendor manifest
                                |
                                v
                    Source adapters and normalizers
                                |
                                v
             Global Release Ledger (deduplicated evidence)
                                |
                                v
                   Relevance matcher and version solver
                                |
                                v
       Repository inventory + pre-indexed AST usage knowledge
                                |
                                v
             Tenant impact candidates and confidence gates
                                |
                                v
           AI classification and constrained patch generation
                                |
                                v
  Rule/AST verification -> container validation -> policy -> GitHub draft PR
```

## Source Adapters

Each adapter has one job: fetch or receive a source, authenticate it where possible, create a
canonical evidence bundle, and emit a normalized `ReleaseObservation`. Adapters do not access
customer repositories or create PRs.

### Tier 1: deterministic release sources

These sources form the launch path because their data is structured and low-cost.

| Source            | Signal                                              | Poll / trigger                                | Initial use                  |
| ----------------- | --------------------------------------------------- | --------------------------------------------- | ---------------------------- |
| npm registry      | package version, publish time, dist-tag, integrity  | every 15 minutes                              | OpenAI, Stripe, Twilio       |
| GitHub Releases   | tag, release notes, prerelease, assets              | webhook or every 30 minutes                   | SDKs maintained on GitHub    |
| GitHub App events | push, dependency-update PR, repository installation | webhook                                       | refresh repository inventory |
| OpenAPI documents | endpoint/schema diff                                | signed webhook, known URL, or vendor manifest | API contract changes         |

### Tier 2: vendor-owned signals

- Signed Patchbay Release Manifest: a vendor posts a versioned JSON document before or at release.
- Vendor webhook: a vendor agent sends a signed `breaking_change`, `deprecation`, or
  `new_capability` event.
- Changelog RSS/API: only allowlisted, vendor-owned feeds are fetched.

### Tier 3: discovery sources

Use these as supplemental evidence, never as the only trigger for automatic remediation.

- Changelog HTML changed since the last content hash.
- Documentation diff.
- Community issue or security advisory.

HTML scraping is useful for triage but weak evidence. It may create a review item; it should not
directly allow an automated patch or PR.

## Canonical Release Contract

Every source adapter emits the same shape. Store raw evidence immutably in object storage and retain
only bounded, redacted metadata in Postgres.

```ts
interface ReleaseObservation {
  source: "NPM" | "GITHUB_RELEASE" | "OPENAPI" | "VENDOR_MANIFEST" | "CHANGELOG";
  vendorSlug: string;
  product: string; // for example: "openai-node"
  version?: string;
  previousVersion?: string;
  publishedAt: string;
  canonicalUrl: string;
  contentHash: string;
  authenticity: "VERIFIED" | "SOURCE_TRUSTED" | "UNVERIFIED";
  evidence: {
    releaseNotes?: string;
    packageIntegrity?: string;
    apiDiff?: ApiDiffFact[];
    manifestSignature?: string;
  };
}
```

The release identity is deterministic:

```text
sha256(source + vendorSlug + product + version + contentHash)
```

This prevents duplicate work when registry polls overlap, GitHub retries a webhook, or a vendor
submits the same manifest twice.

## Release Ledger Data Model

Add these models without mixing global vendor intelligence with tenant data.

```text
VendorProduct
  id, vendorId, ecosystem, packageName, repositoryUrl, openApiUrl, enabled

ReleaseRecord
  id, productId, source, version, previousVersion, publishedAt, canonicalUrl,
  contentHash, authenticity, classificationStatus, createdAt
  unique(source, productId, version, contentHash)

ReleaseEvidence
  id, releaseRecordId, kind, objectStorageKey, contentHash, metadataJson, createdAt

RepositoryDependency
  id, organizationId, repositoryId, packageName, declaredRange, resolvedVersion,
  lockfileKind, commitSha, observedAt
  unique(repositoryId, packageName, commitSha)

ReleaseRepositoryMatch
  id, releaseRecordId, organizationId, repositoryId, dependencyId, matchReason,
  affectedVersionRange, status, createdAt
  unique(releaseRecordId, repositoryId, dependencyId)

ReleaseClassification
  id, releaseRecordId, method, factsJson, confidence, requiresHumanReview, modelTraceId

DetectionRun
  id, adapter, startedAt, completedAt, status, cursor, observedCount, error
```

`ReleaseRecord` is global. `ReleaseRepositoryMatch` is tenant-owned and must carry an explicit
`organizationId`, be guarded by database constraints, and be covered by row-level security once
RLS is enabled.

## Repository Inventory

Watchtower works only when Patchbay has a current inventory of customer code. Inventory is refreshed
at these moments:

1. GitHub App repository connection.
2. Default-branch push webhook.
3. Dependency update PR opened or merged.
4. Scheduled freshness scan, initially every 24 hours for active repositories.
5. Manual scan requested by an administrator.

The inventory stores:

- manifest and lockfile dependency versions;
- package-manager and language profile;
- commit SHA and default branch;
- pre-indexed AST usages: import, initialization, method call, endpoint reference, config, and
  environment reference;
- code locations, bounded excerpts, symbol identity, risk tags, and source hashes.

Do not scan every repository on every upstream release. First compare package name and version range;
then query existing usage facts; only then enqueue a deeper scan if inventory is stale.

## Relevance Matcher

The matcher converts a global release into a small list of tenant work items.

```text
ReleaseRecord(openai 5.0.0)
  -> RepositoryDependency(package=openai, resolvedVersion=4.8.1)
  -> semver/rule match says affected
  -> IntegrationUsage(symbol=chat.completions.create)
  -> ReleaseRepositoryMatch(status=CANDIDATE)
  -> Impact assessment job
```

Matching order:

1. Exact ecosystem/package match.
2. Resolved version or declared range match.
3. Connector-declared affected range, for example `>=4 <5`.
4. Existing AST usage match against changed symbols or API surface.
5. Repository freshness check; rescan only when stale or uncertain.
6. Risk and policy prefilter.

The output is one of:

- `NOT_RELEVANT`: no affected dependency or no relevant usage.
- `MONITOR`: dependency is present but evidence is incomplete.
- `REVIEW`: potentially breaking, evidence or confidence needs review.
- `REMEDIATE`: evidence and affected usage meet the connector/rule threshold.

## What the AI Harness Receives

The harness receives a bounded, structured packet. It never receives the entire repository, raw
credentials, arbitrary URLs, or a tool that can perform a network request.

```ts
interface PatchGenerationInput {
  release: ReleaseRecord;
  verifiedFacts: NormalizedChange[];
  repository: { id: string; commitSha: string; languageProfile: unknown };
  affectedUsages: Array<{ filePath: string; symbol: string; excerpt: string; riskTags: string[] }>;
  connectorRules: ConnectorRule[];
  policy: PolicyDefinition;
}
```

The harness may return only structured actions:

```text
NO_CHANGE | REQUEST_MORE_EVIDENCE | PLAN_ONLY | PROPOSE_PATCH
```

For `PROPOSE_PATCH`, every changed file and edit must pass all gates:

1. File is one of the affected/retrieved files.
2. Patch applies cleanly to the expected source hash.
3. AST preconditions and connector rules validate.
4. Diff size and file-count limits pass.
5. Container validation passes.
6. Policy permits a draft PR or auto-merge.

The model is never granted Docker access, GitHub write access, shell execution, secret access, or
unlimited repository search. Patchbay owns those capabilities and calls them only after the model's
structured output has passed deterministic checks.

## Confidence and Policy

Confidence must be decomposed, not invented as one model number.

```text
release authenticity     0-25
change evidence quality  0-25
dependency/version match 0-20
AST usage match          0-20
patch verification       0-10
```

Suggested policy defaults:

| Condition                                                      | Action                                       |
| -------------------------------------------------------------- | -------------------------------------------- |
| Unverified source or incomplete evidence                       | monitor or human review only                 |
| No affected usage                                              | record observation, no customer notification |
| High-risk tag: payment, auth, PII, webhook, infrastructure     | draft PR plus required approval              |
| Deterministic rule + passing container validation + low risk   | draft PR automatically                       |
| Customer explicitly enables auto-merge + protected checks pass | merge only under that policy                 |

"Invisible" means no migration toil. It must never mean invisible changes to a customer's default
branch without their explicit policy and audit trail.

## Queue Topology

Use durable, independently retryable jobs. Every job has an idempotency key and correlation ID.

```text
poll-source(product)              -> observe-release
ingest-vendor-manifest            -> observe-release
observe-release                   -> classify-release
classify-release                  -> match-repositories
match-repositories                -> assess-impact
assess-impact                     -> generate-plan
generate-plan                     -> validate-plan
validate-plan                     -> create-pr
```

Recommended cadence for launch:

| Job                              | Cadence             | Guard                                 |
| -------------------------------- | ------------------- | ------------------------------------- |
| npm package poll                 | 15 minutes          | one leader lock per product           |
| GitHub release poll              | 30 minutes          | ETag/cursor and content hash          |
| active repository freshness scan | 24 hours            | repository commit SHA comparison      |
| failed source retry              | exponential backoff | dead-letter queue and alert           |
| signed vendor manifest           | event-driven        | signature + nonce + replay protection |

## Source Adapter Security

- Allowlist source domains per vendor product; never fetch an arbitrary `sourceUrl` supplied by a
  user or vendor event.
- Set strict request timeouts, response byte limits, redirect limits, and content-type checks.
- Store raw evidence in tenant-neutral object storage with content-addressed keys.
- Verify vendor manifest signatures with a rotating public-key set.
- Use ETags and conditional requests to reduce polling cost and accidental rate-limit pressure.
- Persist webhook delivery IDs and source content hashes for replay protection.
- Do not let a source adapter enqueue a PR directly; it can only create a release observation.

## Automated Polling (implemented)

Every adapter is conditional and cursor-based, so repeated polls are cheap (one 304 or an empty
packument diff):

- `WatchtowerAdapter.fetch(cursor?)` returns `{ evidence, cursor }`. The cursor (ETag, last
  observed version/tag, seen version list, last spec body) is persisted on `DetectionRun.cursor`
  by the `detect-releases` worker and passed back on the next poll.
- npm polls the registry packument; versions published since the cursor are emitted with their
  chronological `previousVersion` (classification relies on it for diffing).
- GitHub releases polls with `If-None-Match` + a persisted last-published date; drafts and
  prereleases are never emitted.
- OpenAPI fetches are ETag-conditional; on change, evidence carries a deterministic `apiDiff`
  fact set (added/removed operations, shape changes, `breaking`) computed from the previous spec
  stored in the cursor.

Scheduling is done with BullMQ job schedulers registered idempotently at worker boot:

| Scheduler                | Cadence | Sources        | Env override (ms)                    |
| ------------------------ | ------- | -------------- | ------------------------------------ |
| `watchtower-npm-openapi` | 15 min  | npm, OpenAPI   | `WATCHTOWER_POLL_INTERVAL_NPM_MS`    |
| `watchtower-github`      | 30 min  | GitHub release | `WATCHTOWER_POLL_INTERVAL_GITHUB_MS` |

Set `WATCHTOWER_POLLING_ENABLED=false` on any worker that must not touch external registries.
Schedulers live in Redis, so one worker instance is enough; BullMQ distributes repeats, and
database dedupe (`ReleaseRecord` content-hash uniqueness) makes overlapping polls harmless.

## Launch Scope: the First Powerful Version

Do not launch all 56 connectors as equal. Launch three deep products:

1. OpenAI Node SDK.
2. Stripe Node SDK.
3. Twilio Node SDK.

For each, support:

- npm release detection;
- GitHub release/changelog evidence where available;
- five to ten high-confidence breaking migration patterns;
- repository dependency inventory;
- affected usage matching;
- draft PRs with validation and evidence links;
- human approval for sensitive paths.

The initial customer is a team with 10 or more repositories and real dependency-change pain. The
initial promise is not "we support every API." It is "we stop these three vendor changes from
becoming production incidents."

## Evaluation Framework

Watchtower must be measured like a detection product, not merely a code-generation demo.

| Metric                    | Meaning                                           | Initial target                  |
| ------------------------- | ------------------------------------------------- | ------------------------------- |
| Release detection latency | publish time to ReleaseRecord                     | under 15 minutes for npm        |
| Matching precision        | matched repos that truly need attention           | over 90%                        |
| Matching recall           | known affected repos successfully matched         | over 95%                        |
| Patch validation rate     | proposed patches passing container validation     | over 80% for supported patterns |
| PR acceptance rate        | Patchbay PRs merged or accepted after minor edits | over 60%                        |
| False-positive rate       | customer alerts with no meaningful impact         | under 10%                       |
| Mean time to remediation  | release detected to merged/approved PR            | trend downward per vendor       |

Build a replay corpus from historical OpenAI, Stripe, and Twilio releases. For every release, keep
the release evidence, fixture repositories, expected affected usages, expected policy outcome, and
expected patch. Run this corpus in CI whenever connectors, models, prompts, or matchers change.

## Phased Implementation Plan

### Phase W1: Release Ledger and npm watch

- Add `VendorProduct`, `ReleaseRecord`, `ReleaseEvidence`, and `DetectionRun`.
- Schedule the existing npm poller through BullMQ repeatable jobs or a dedicated scheduler service.
- Replace the current "fan out to all organizations" behavior with global release storage.
- Add release deduplication and ETag/content-hash handling.
- Build a dashboard view for observed releases and detector health.

### Phase W2: Repository dependency inventory and matching

- Persist lockfile-resolved dependency versions by repository commit SHA.
- Add `RepositoryDependency` and `ReleaseRepositoryMatch`.
- Implement semver/rule matching and stale inventory handling.
- Fan out only to matching repositories and organizations.
- Add a "Why was this repository matched?" evidence view.

### Phase W3: Evidence and classification

- Add GitHub Release and signed vendor-manifest adapters.
- Implement OpenAPI diff ingestion for allowlisted specs.
- Create structured AI classification with schema validation and provenance.
- Introduce release-confidence gates and review queues.

### Phase W4: Constrained patch-generation agent

- Provide only release facts, affected usages, connector rules, and scoped source files.
- Enforce source-hash preconditions, AST verification, diff budgets, and container validation.
- Add model cost budgets, per-organization quotas, trace IDs, and replay evaluation.

### Phase W5: Vendor network and enterprise scale

- Vendor portal for signed manifests, rollout windows, and compatibility declarations.
- Customer policy controls, Slack/Teams notifications, and signed evidence exports.
- PostgreSQL RLS, SSO/SCIM, token rotation, regional data controls, and billing/metering.

## Definition of Done for Watchtower v1

Watchtower v1 is complete when a newly published supported npm package version creates exactly one
global release record; only repositories with a matching dependency and relevant AST usage receive a
tenant impact candidate; every candidate links to immutable release evidence; the patch harness runs
only after deterministic gates pass; and the final GitHub draft PR contains evidence, validation
results, policy decision, and an auditable correlation ID.
