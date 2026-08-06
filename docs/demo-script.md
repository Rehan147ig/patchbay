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

1. `/demo` -> choose **"Auth0 configuration change"**.
2. Expected: impact detected on `auth-gateway`; plan exists (may be AI-drafted/mark plan-only);
   policy decision = REQUIRE_APPROVAL; PR creation endpoint returns 403-style blocked decision;
   audit event records the block.
3. Admin approves on `/remediations/[id]`; only then may the flow proceed to a draft PR (approval
   recorded, audited).

## Scenario C - Generic OpenAPI response field removed (plan-only)

1. `/demo` -> choose **"Generic OpenAPI change"**, paste the bundled old/new documents (or use
   the fixture pair shipped in `fixtures/openapi/`).
2. Expected: diff detects the removed response property; breaking `NormalizedChange` created;
   impact assessed on `generic-openapi-client`; policy = plan-only; no patch generated; audit
   trail written.

## Reset

`/demo` -> "Reset demo data" (or `pnpm db:reset`): wipes demo-generated remediations, PRs,
validations, approvals, and demo-created events, then re-seeds baseline state.

## Exit criteria for the demo

- A stored RemediationPlan + PatchArtifact + ValidationRun + PullRequest (mock) + >= 8 audit
  events for scenario A.
- A blocked-by-policy audit event for scenario B before approval.
- A plan-only outcome with no PatchArtifact for scenario C.
