# Private Beta Onboarding — Best Results in 15 minutes

**You get:** autonomous `openai→vercel-ai-sdk/stripe/twilio/anthropic/supabase` patches, `IMPACT GRAPH` per commit, `DRAFT PR` only, `WORM audit`.

## 1. One-line local test (no signup)

```bash
npx patch-migrate vercel-ai-sdk --cwd fixtures/repositories/vercel-ai-sdk-legacy --dry-run
# expect: src/app.ts useChat → useChat /* v4 */ patch, 0 errors
```

## 2. GitHub App (continuous)

1. Admin → `https://github.com/apps/patchbay/installations/new` → select repos → `POST /api/github/callback` creates `GitHubInstallation` org-bound
2. Watchtower polls `npm` + `openapi` every 15m `watchtower.ts:8` → `ReleaseRecord` → `classify-release` → `match-release` → `RemediationCase`
3. Worker opens `Draft PR` (never auto-merge) — `POLICY` `PAYMENT/AUTH` → `REQUIRE_APPROVAL`

## 3. CI Action (customer-owned runner)

```yaml
# .github/workflows/patch.yml
- uses: Rehan147ig/patchbay/action.yml@v1
  with:
    vendor: vercel-ai-sdk
    write: true
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 4. Private SDK (internal)

```bash
curl -X POST https://patch.dev/api/vendors/acme-auth/agent-key -H "Cookie: pb_session=..." | jq .data.agentKey # pb_agent_...
curl -X POST https://patch.dev/api/vendors/acme-auth/events -H "Authorization: Bearer pb_agent_..." -d '{"externalReference":"acme-2.0.0","sourceType":"SDK_RELEASE","severity":"HIGH","rawPayload":{"sdk":"acme-auth","fromVersion":"1.x","toVersion":"2.x"}}'
```

## 5. Hardening you inherit

- `withOrgContext` + `FORCE RLS` `20260902000000_rls_foundation` on 29 tables
- `HMAC` registry `x-patch-signature` `timingSafeEqual` + 7-day `NEXT` rotation `kms-rotation-drill.md`
- `container` sandbox `cap-drop ALL no-new-privileges read-only` + `DLQ` `alertDlq` → `ALERT_WEBHOOK_URL`
- `OTel` stub → set `OTEL_ENABLED=1` + `OTEL_EXPORTER_OTLP_ENDPOINT`
- `audit/export?format=splunk|cef` `x-patch-signed-export` + `SCIM` `POST /api/scim/Users` `Bearer SCIM_TOKEN`

## 6. Exit criteria for GA

- 0 high pentest findings `pentest-scope.md`, KMS drill done, 6 `DRAFT_PR` green `pnpm test:corpus` 35/35, `pnpm build` green — all verified.
