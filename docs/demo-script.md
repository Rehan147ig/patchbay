# Patchbay - Demo Script

Audience: a new developer running the MVP locally. Prereq: `pnpm install`, `docker compose up -d`,
`pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`. Open http://localhost:3000, sign in on `/login`
(one-click demo user).

All data shown is seeded demo data and labeled as such.

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

## Reset

`/demo` -> "Reset demo data" (or `pnpm db:reset`): wipes demo-generated remediations, PRs,
validations, approvals, and demo-created events, then re-seeds baseline state.

## Exit criteria for the demo

- A stored RemediationPlan + PatchArtifact + ValidationRun + PullRequest (mock) + >= 8 audit
  events for scenario A.
- A blocked-by-policy audit event for scenario B (`POLICY_BLOCKED`); approval is recorded and
  audited; no draft PR is created (Auth0 is not certified for `DRAFT_PR`).
- A plan-only outcome with no PatchArtifact for scenario C.
