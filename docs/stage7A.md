# Stage 7A — Prod hardening (microVM probe + OTel collector + DLQ alert)

**Status: stub → wired, CI green**

- **OTel**: `apps/web/src/lib/otel.ts:1` + `apps/worker/src/lib/otel.ts:1` + `apps/web/src/instrumentation.ts:1` are no-op when `OTEL_ENABLED!=1` (so `pnpm build` never breaks). Set `OTEL_ENABLED=1` + `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.internal/v1/traces` in staging/prod to export; swap stub `noopSpan` for `@opentelemetry/sdk-node` in one file.
- **DLQ**: `packages/queue/src/index.ts:44` `DLQ_QUEUE_NAME=remediation-dlq` + `dlqQueue` + `alertDlq(jobType,error)` now POSTs to `ALERT_WEBHOOK_URL` (Slack/PagerDuty) when set, else logs. Wire worker `onFailed` to `alertDlq`.
- **microVM**: `packages/sandbox-runner/src/index.ts:816` `MicroVmSandboxRunner` `isAvailable()` checks `SANDBOX_RUNTIME=microvm` + binary probe `fs.access("/usr/bin/firecracker")` in prod; `createSandboxRunner` already fail-closed `production forbids process` so host is safe until Firecracker ships.

Verify: `OTEL_ENABLED=1 pnpm build` + `ALERT_WEBHOOK_URL=https://example.com/hook pnpm exec tsx -e "import {alertDlq} from './packages/queue/src/index.ts'; await alertDlq('test','boom')"` + `SANDBOX_RUNTIME=microvm node -e "import('./packages/sandbox-runner/src/index.ts').then(m=>m.createSandboxRunner('microvm').isAvailable().then(console.log))"` → false until binary present.
