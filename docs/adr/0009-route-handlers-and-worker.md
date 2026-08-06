# ADR-0009: Next.js route handlers as API; worker as separate process

Status: accepted

## Context

The MVP needs a typed API plus background jobs. A separate Fastify service would add deployment
and tooling surface without payoff at this scale.

## Decision

- Apps/web serves the dashboard and the JSON API as Next.js route handlers (typed, Zod-validated,
  audit-aware, correlation-id aware).
- Long-running work (scan, analyze, validate, create-pr) is enqueued to BullMQ and processed by
  `apps/worker` (tsx), sharing the same packages and Prisma client.
- `apps/worker` is runnable independently, keeping the web process free of CPU-heavy analysis.

## Consequences

- Single app for the API surface; separate process boundary for jobs.
- If the API outgrows Next later, the route handlers are thin wrappers over packages and can be
  re-hosted on Fastify without rewriting engines.
