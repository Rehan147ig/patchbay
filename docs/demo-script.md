# Patchbay - Demo Script

Audience: a new developer running the MVP locally. Prereq: `pnpm install`, `docker compose up -d`,
`pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`. Open http://localhost:3000, sign in on `/login`
(one-click demo user).

All data shown is seeded demo data and labeled as such.

> Draft PRs in this demo are local mocks. Real GitHub draft PRs require a GitHub App
> install (`GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` in `.env`); the local demo does not.

## Scenario A - OpenAI SDK migration (happy path)

1. Go to `/demo`, choose **"OpenAI SDK migration"**, run it.
2. Expected sequence (observable in UI + `pnpm exec prisma studio` if desired):
   - `VendorChangeEvent` created (source: SDK_RELEASE, severity HIGH, breaking).
   - Repository `ai-assistant-service` scanned; `createChatCompletion` usage indexed
     (file, line, column, excerpt).
   - Impact assessment: AFFECTED, impact + confidence scores with rationale.
   - Remediation plan: rule-based patch (method rename to `client.chat.completions.create`),
     unified diff visible in UI.
   - Validation run: allowlisted commands pass.
   - Policy: no high-risk tags, confidence >= threshold -> ALLOW_DRAFT_PR.
   - Local mock draft PR created (branch, mock URL).
   - Audit timeline shows every step with correlation ids.
3. `/remediations/[id]` shows diff, validation logs, policy decision, PR link, audit timeline.

## Scenario B - Auth0 configuration change (policy gate)

1. Go to `/demo`, choose **"Auth0 configuration change"**, run it.
2. Expected sequence:
   - `VendorChangeEvent` created (`Auth0 SDK: authentication middleware signature changed`, severity HIGH).
   - Impact assessed on `auth-gateway` (`src/middleware/authn.ts` calling `auth0.verifyJwt`).
   - Connector emits `AUTH_CHANGE` with `AUTH` risk tag.
   - Policy engine evaluates `p-auth-approval` -> `REQUIRE_APPROVAL`.
   - PR creation endpoint returns blocked decision; audit log records `POLICY_BLOCKED`.
3. An admin can record plan approval on `/remediations/[id]`. The approval is recorded and
   audited. Auth0 is not certified for `DRAFT_PR`; draft PR creation remains blocked by the
   certification gate even after approval.

## Scenario C - Generic OpenAPI response field removed (plan-only)

1. Go to `/demo`, choose **"Generic OpenAPI response field removed"**, run it.
2. Expected sequence:
   - `VendorChangeEvent` created (`Generic OpenAPI: response field removed`, sourceType: OPENAPI_DIFF).
   - `NormalizedChange` created for `RESPONSE_FIELD_REMOVED`.
   - Remediation plan generated without automated code patch (plan-only).
   - Policy evaluates `p-generic-plan-only` -> `ALLOW_PLAN_ONLY`.
   - No `PatchArtifact` is created; audit trail records plan completion.

## Scenario D - Stripe customers.create metadata (approval-then-PR)

1. Go to `/demo`, choose **"Stripe customers.create metadata"**, run it.
2. Expected sequence:
   - `VendorChangeEvent` created (`Stripe API: customers.create now requires metadata tracking`, severity HIGH).
   - Impact assessed on `billing-service` (`src/payments/customers.ts` calling `stripe.customers.create`).
   - Connector emits `PARAMETER_REQUIRED` (metadata) with `PAYMENT` risk tag; rule-based patch applies the metadata insert.
   - Policy engine evaluates the `PAYMENT` risk -> `REQUIRE_APPROVAL`; PR creation returns blocked decision; audit log records `POLICY_BLOCKED`.
   - An admin records plan approval on `/remediations/[id]`; validation passes.
   - Stripe is certified for `DRAFT_PR` (unlike Auth0): policy now evaluates `ALLOW_DRAFT_PR` and a local mock draft PR is created.
3. Contrast with Scenario B: same approval gate, but Auth0 is not certified for `DRAFT_PR`, so no draft PR follows its approval.

## Scenario E - Anthropic Completions → Messages (DRAFT_PR)

1. Go to `/demo`, choose **"Anthropic Completions → Messages"**, run it.
2. Expected sequence:
   - `VendorChangeEvent` created (`Anthropic SDK: completions.create replaced by messages.create`, severity HIGH).
   - Impact assessed on `claude-assistant-service` (`src/chat/complete.ts` calling `anthropic.completions.create`).
   - Connector emits `METHOD_RENAMED` (`anthropic.completions.create` → `anthropic.messages.create`); rule-based line rename.
   - Policy: no high-risk tags → `ALLOW_DRAFT_PR`; local mock draft PR created (Anthropic is certified `DRAFT_PR`).

## Scenario F - AWS SDK v2 → v3 client constructors (DRAFT_PR, constructor rename only)

1. Go to `/demo`, choose **"AWS SDK v2 → v3 clients"**, run it.
2. Expected sequence:
   - `VendorChangeEvent` created (`AWS SDK v3: service constructors replaced by v3 clients`, severity HIGH).
   - Impact assessed on `aws-workers-service` (`src/aws-clients.ts` with `new AWS.S3()`, `new AWS.SQS()`, `new AWS.DynamoDB()`).
   - Connector emits a line-level constructor rename (`AWS.S3` → `S3Client`, `AWS.SQS` → `SQSClient`, `AWS.DynamoDB` → `DynamoDBClient`).
   - The kit is **constructor rename only** — it does not rewrite `.promise()`, imports, or SendCommand shapes.
   - `INFRASTRUCTURE` risk → `REQUIRE_APPROVAL`; a mock draft PR follows admin approval (AWS SDK is certified `DRAFT_PR`).

## Scenario G - Supabase auth.user → getUser (DRAFT_PR, AUTH approval)

1. Go to `/demo`, choose **"Supabase auth.user → getUser"**, run it.
2. Expected sequence:
   - `VendorChangeEvent` created (`Supabase JS v2: auth.user replaced by auth.getUser`, severity HIGH).
   - Impact assessed on `supabase-backend-service` (`src/auth/session.ts` calling `supabase.auth.user()`).
   - Connector emits `METHOD_RENAMED` with the `AUTH` risk tag; rule-based line rename.
   - Policy: `AUTH` risk → `REQUIRE_APPROVAL`; a mock draft PR follows admin approval (Supabase is certified `DRAFT_PR`).

## Reset

`/demo` -> "Reset demo data" (or `pnpm db:reset`): wipes demo-generated remediations, PRs,
validations, approvals, and demo-created events, then re-seeds baseline state.

## Exit criteria for the demo

- A stored RemediationPlan + PatchArtifact + ValidationRun + PullRequest (mock) + >= 8 audit
  events for scenario A.
- A blocked-by-policy audit event for scenario B (`POLICY_BLOCKED`); approval is recorded and
  audited; no draft PR is created (Auth0 is not certified for `DRAFT_PR`).
- A plan-only outcome with no PatchArtifact for scenario C.
- For scenario D: a `POLICY_BLOCKED` until approval, then a mock draft PR after admin approval and
  passing validation (stripe is certified for `DRAFT_PR`).
- For scenarios E/F/G: a mock draft PR after approval where required (Anthropic plan-only path,
  AWS `INFRASTRUCTURE` and Supabase `AUTH` require approval); no Python or Auth0 draft PR is ever
  produced.
