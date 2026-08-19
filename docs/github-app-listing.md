# GitHub App Listing

Paste-ready copy for the GitHub App public page, permissions form, and "What
does this app do?" description. Everything here is sourced from the code in
`packages/git-provider`, `apps/web/src/app/api/webhooks/github/route.ts`, and
`packages/vendor-connectors/src/capabilities.ts` — if a permission, event, or
capability is not listed, Patchbay does not use it.

## App name (suggested)

**Patchbay** — Migration Detection & Draft-PR Remediation

## Short description (public page)

Patchbay watches the SDKs your repositories depend on, detects upstream
breaking changes, and opens **draft pull requests** with proposed fixes for
your review. Nothing is merged automatically: every change is human-approved
before it touches your default branch, and Patchbay never runs your code on
its own servers in production.

## Permissions (least privilege)

These are the only permissions Patchbay uses. Request exactly these; do not
grant checks, merge, issues, or commit statuses — Patchbay has no code paths
that call those APIs.

| Permission    | Access             | Why it is used                                                                                                                                        |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contents      | **Read and write** | Read repository files, create feature branches, and write patched files into the draft-PR branch (`GET`/`PUT` `/contents`, `GET`/`POST` `/git/refs`). |
| Pull requests | **Read and write** | Create **draft** pull requests (`POST /pulls` with `draft: true`).                                                                                    |
| Metadata      | **Read**           | Resolve repository metadata. Required by GitHub for any installation.                                                                                 |
| Webhooks      | —                  | Receives `installation`, `pull_request`, and `push` events (see below).                                                                               |

Patchbay does **not** use the Checks API (no check runs), does **not** merge
pull requests, does **not** create issues or comments, and does **not** write
to your default branch directly. Writes only ever happen on feature branches
Patchbay itself creates.

## Webhook events

Subscribe Patchbay to exactly these events:

| Event          | What Patchbay does with it                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installation` | Syncs installation metadata; marks the install suspended on `deleted`/`suspend`.                                                                                                        |
| `pull_request` | Tracks the lifecycle of PRs Patchbay opened (e.g. closed/merged → outcome learning). Never opens a PR from a webhook; PRs only come from the remediation pipeline after human approval. |
| `push`         | Enqueues an incremental repository-graph refresh for connected repositories (no code is executed).                                                                                      |

All deliveries are HMAC-verified against `GITHUB_APP_WEBHOOK_SECRET`
(`x-hub-signature-256`). Any other event type is acknowledged and ignored.

## What Patchbay does (and does not) do

- **Draft PRs only, never auto-merge.** Patchbay opens pull requests in
  `draft` state. A human must review and merge.
- **Human approval gates.** Changes touching payments, authentication,
  PII, webhooks, or infrastructure require explicit human approval before
  a plan is enacted; nothing is enacted without it.
- **Certified patch kits exist for a small, honest set of SDKs.** A catalog
  entry is not an auto-fix — see the support matrix below.
- **Validation honesty.** Patchbay reports exactly what validation happened:
  - `hosted-docker` — a production sandbox run in an isolated container
    (fail-closed default).
  - `github-checks-only` — Patchbay does **not** execute customer code; your
    CI runs the proposed patch and Patchbay records the outcome as
    `SKIPPED`, which is **never** reported as `PASSED`.
  - `process` — local development mode only, never multi-tenant.
    No validation mode ever fabricates a `PASSED` result.

## Support matrix (as implemented, from `capabilities.ts`)

| Capability                                           | Vendors                                                                 | What it means                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DRAFT_PR** (certified patch kits, Node/TypeScript) | `openai`, `stripe`, `twilio`, `anthropic`, `aws-sdk`, `supabase`        | Patchbay detects breaking changes and produces **line-level** code patches for these SDKs, verified against the H8 eval corpus (CI gate: patches must apply to fixtures). AWS is constructor rename only (`AWS.S3` → `S3Client`), not a full v3 SendCommand rewrite. |
| **PLAN**                                             | `auth0`                                                                 | Breaking changes are detected and a remediation plan is produced, but **no code patches** — a human does the edit.                                                                                                                                                   |
| **ASSESS**                                           | `generic-openapi` (any OpenAPI-spec SDK)                                | Detection/assessment only; no patches.                                                                                                                                                                                                                               |
| **ASSESS (catalog baseline, 50+ connectors)**        | e.g. `google-gemini`, `axios`, `react`, `prisma`, `express`, `clerk`, … | Catalog presence ≠ auto-fix. These connectors are detected/assessed only until their patch kit is certified.                                                                                                                                                         |
| **Detect-only**                                      | Python ecosystem                                                        | Patchbay detects Python SDK releases and assesses their breaking changes, but there is **no Python patch kit** — no Python DRAFT_PR, ever.                                                                                                                           |

### What "catalog ≠ auto-PR" means

Having 50+ connectors in the catalog does not mean Patchbay opens pull
requests for all of them. A draft PR is only opened when (a) the connector is
certified at DRAFT_PR with a corpus-verified patch kit, and (b) a human
approved the plan. Everything else stops at assessment or a plan for a human
to review.

## Keeping this document honest

If the permission table, event list, or support matrix above disagrees with
the code, the code wins. Update this file at the same time as the code —
there is intentionally no marketing language here beyond what the
implementations actually do.
