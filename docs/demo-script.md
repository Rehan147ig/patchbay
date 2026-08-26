# Patch launch demo — OpenAI SDK break → draft PR

One path, ~15 minutes: install the GitHub App, connect a TypeScript repo, detect an OpenAI SDK
break, generate a plan, open a draft PR. Patch never auto-merges; a human reviews and merges.

## Prerequisites

- Docker Desktop running (`docker compose up -d` → Postgres 5434, Redis 6380)
- `.env`: `DATABASE_URL`, `REDIS_URL`, dev auth secret, and the four GitHub App vars —
  `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (base64 PEM),
  `GITHUB_APP_WEBHOOK_SECRET`. Missing any of them shows an explicit "App not configured"
  banner on `/onboarding` and `/settings/github`.
- First run: `pnpm db:migrate && pnpm db:seed`, then `pnpm dev`.

## Steps

1. **Sign in** — open `/login` and use the seeded admin (`demo@patchbay.dev`; local dev auth is
   configured via `docs/self-host.md`). You land on the overview.

2. **Install the GitHub App** — go to `/onboarding`. Step 1 links to your App
   (`github.com/apps/<GITHUB_APP_SLUG>/installations/new`) and requests exactly three permissions:
   Contents read/write, Pull requests read/write, Metadata read. Installing returns you to
   `/settings/github`, where the installation appears with its installation ID. Draft PRs only;
   agents never hold git tokens.

3. **Connect one TypeScript repository** — back on `/onboarding` step 2, enter the installation ID
   from step 2 and `owner/repo` for a real repo that imports the OpenAI Node SDK v3 or earlier.
   Status becomes connected; it now appears on `/repositories`. Use a DRAFT_PR-certified SDK repo
   (`openai`, `stripe`, `twilio`, `anthropic`, or `supabase`) so the path ends in a patch.

4. **Scan for usages** — on `/repositories`, trigger a scan for the repo. Expected progression:
   QUEUED → RUNNING → COMPLETED, then an inventory of tracked SDK call sites (file + line).

5. **Detect the break** — create the vendor change (from the `/demo` page's guided scenario, or
   `POST /api/vendor-changes` with an OpenAI `createChatCompletion → chat.completions.create`
   migration payload), then run analysis. The change appears on `/changes` with severity and its
   signal source (SDK release / OpenAPI diff).

6. **Plan** — open the change on `/changes/[id]` and generate the plan. Patch matches affected
   usages against the certified OpenAI rule pack and produces a remediation plan with unified-diff
   patches. The semantic gate re-checks every patched file; files with new errors are skipped and
   reported, never silently shipped.

7. **Approve if required** — breaking/payment/auth changes require an admin approval before a PR
   can be created; the remediation page states this explicitly when it applies.

8. **Validate** — run validation from the remediation (`/remediations/[id]`). Expected: PASSED.
   With `SANDBOX_VALIDATION_MODE=github-checks-only` the status reports SKIPPED — never PASSED;
   your CI is the judge.

9. **Draft PR** — once validated (and approved where required), create the draft PR. It opens as a
   draft at `https://github.com/<owner>/<repo>/pull/<number>` via the App installation token.
   Review and merge it yourself — Patch never merges.

## Failure tips

| Symptom                                                                   | Fix                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 422 "GitHub installation not found for your organization" when connecting | The installation ID is missing or belongs to another org — reinstall the App (step 2) and copy the ID from `/settings/github`. |
| Fixture repos won't connect                                               | Repos under `fixtures/repositories` are local samples, not GitHub installations. Connect a real repo the App is installed on.  |
| Draft PR / validate returns 422                                           | Capability gate SUSPENDED for this vendor (merge-rate threshold). An ADMIN restores it via `POST /api/capability-gates`.       |
| Scan stuck QUEUED                                                         | Worker not running or Redis down — check `pnpm dev` worker output.                                                             |
| Validation FAILED: lockfile errors                                        | Commit `pnpm-lock.yaml` matching `package.json` in the target repo.                                                            |

## Honest limits

Draft PRs only, never auto-merge. `aws-sdk` and `auth0` are PLAN level (no patches);
`openai-python` and private/internal SDKs are ASSESS level (impact visibility, no certified patch
kit). Behavioral (Tier 4) changes need human review of vendor changelogs.
