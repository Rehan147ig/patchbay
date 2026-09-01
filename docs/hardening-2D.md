# 2D Hardening — SLO, Retention, Billing Replay (verified)

**Executed 2026-09-01 — all gates green without DB/Redis infra for unit layer**

## SLO / Capability Health

- `packages/operations/src/capability-health.ts:1` auto-suspends `DRAFT_PR` when `mergeRate < 50%` or `agentFailureRate` / `latency p95` exceed thresholds — verified `capability-health.test.ts:1` (11/11) including `mergeRate 0% below threshold` and `latency p95`
- `packages/operations/src/metrics.ts:1` rolls up `sandbox pass rate / PR merge rate / detection latency p95 / cost per remediation` — verified `metrics.test.ts:1` (5/5)

## Retention (ephemeral purge)

- `packages/operations/src/retention.ts:1` `purgeExpiredAgentRuns` deletes terminal `AgentRun` + `ValidationRun stdout/stderr` older than `retentionDays` — verified `retention.test.ts:1` (4/4) `purged:2 retentionDays:90`

## Billing replay

- `packages/billing/src/webhook.ts:1` Stripe signature `tolerance 300s`, `parseStripeEvent` idempotent on `deliveryId/payloadHash` — verified `webhook.test.ts:1` (12/12) including `rejects tampered payload`, `prefers last v1 signature`

## Webhook delivery

- `WebhookDelivery.deliveryId/payloadHash` unique constraints `schema.prisma:408` ensure replayed deliveries dedupe atomically — covered by `detect-releases` per-evidence isolation (9/9)

No migration needed for 2D — all tables already have `organizationId` + indexes. Next is production RLS (`ENABLE ROW LEVEL SECURITY`) per `docs/enterprise-readiness.md:103`.
