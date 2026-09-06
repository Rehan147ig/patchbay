# Capability Matrix (generated — do not edit by hand)

> Source: `packages/vendor-connectors/src/capabilities.ts` `CAPABILITY_REGISTRY`. Run `pnpm exec tsx scripts/generate-capability-matrix.ts` to regenerate. Checked in CI.

**Total connectors: 64** — DRAFT_PR: 9 · PLAN: 4 · ASSESS: 51 · Spec mapping: DETECT→detect-only, ASSESS→impact-analysis, PLAN/VALIDATE→plan-only, DRAFT_PR→draft-PR, autonomous-generic→autonomous.

| Vendor slug | Ecosystem | Package / spec | Language | Level | Spec capability | Policy class | Certified | Rule pack | Validation profile |
|---|---|---|---|---|---|---|---|---|---|
| `adyen` | npm | `adyen` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `algolia` | npm | `algoliasearch` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `anthropic` | npm | `@anthropic-ai/sdk` | typescript/javascript | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | node-ts-reparse + container-sandbox |
| `auth0` | npm | `auth0` | typescript/javascript | `PLAN` | plan-only | PLAN_ONLY | 2026-08-17 | 1.0.0 | node-ts-reparse |
| `autonomous-generic` | npm | `package.json manifest (any npm direct dependency)` | typescript/javascript | `DRAFT_PR` | autonomous | APPROVAL_REQUIRED | 2026-09-04 | semver-bump/1.0.0 | node-ts-reparse + container-sandbox |
| `aws-sdk` | npm | `aws-sdk` | typescript/javascript | `PLAN` | plan-only | PLAN_ONLY | 2026-08-17 | 1.0.0 | node-ts-reparse |
| `axios` | npm | `axios` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `azure-openai` | npm | `@azure/openai` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `azure-sdk` | npm | `@azure/identity` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `clerk` | npm | `@clerk/nextjs` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `cloudflare` | npm | `wrangler` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `cohere` | npm | `cohere-ai` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `deepseek` | npm | `deepseek` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `digitalocean` | npm | `digitalocean` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `discord` | npm | `discord.js` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `drizzle` | npm | `drizzle-orm` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `elasticsearch` | npm | `@elastic/elasticsearch` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `express` | npm | `express` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `firebase` | npm | `firebase` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `generic-openapi` | openapi | `openapi-spec` | openapi | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `google-cloud` | npm | `@google-cloud/storage` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `google-gemini` | npm | `@google/generative-ai` | typescript/javascript | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | node-ts-reparse + container-sandbox |
| `groq` | npm | `groq-sdk` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `hubspot` | npm | `@hubspot/api-client` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `huggingface` | npm | `@huggingface/inference` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `keycloak` | npm | `keycloak-js` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `kubernetes` | npm | `@kubernetes/client-node` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `langchain` | npm | `langchain` | typescript/javascript | `PLAN` | plan-only | PLAN_ONLY | 2026-08-17 | 1.0.0 | node-ts-reparse |
| `lemon-squeezy` | npm | `lemon-squeezy` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `mcp-generic` | mcp | `mcp-tools-list` | typescript/javascript | `PLAN` | plan-only (MCP) | PLAN_ONLY | 2026-09-04 | mcp-diff/1.0.0 | node-ts-reparse |
| `mistral` | npm | `@mistralai/mistralai` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `mongodb` | npm | `mongodb` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `mongoose` | npm | `mongoose` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `next` | npm | `next` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `next-auth` | npm | `next-auth` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `okta` | npm | `@okta/okta-auth-js` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `openai` | npm | `openai` | typescript/javascript | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | node-ts-reparse + container-sandbox |
| `openai-python` | pypi | `openai` | python | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | python-tree-sitter-reparse + container-sandbox |
| `passport` | npm | `passport` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `paypal` | npm | `@paypal/checkout-server-sdk` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `plaid` | npm | `plaid` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `postgresql` | npm | `pg` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `prisma` | npm | `@prisma/client` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `react` | npm | `react` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `redis` | npm | `ioredis` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `replicate` | npm | `@replicate/replicate` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `salesforce` | npm | `jsforce` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `sendgrid` | npm | `@sendgrid/mail` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `sentry` | npm | `@sentry/nextjs` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `sequelize` | npm | `sequelize` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `shopify` | npm | `@shopify/shopify-api` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `slack` | npm | `@slack/web-api` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `socket.io` | npm | `socket.io` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `square` | npm | `square` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `stripe` | npm | `stripe` | typescript/javascript | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | node-ts-reparse + container-sandbox |
| `supabase` | npm | `@supabase/supabase-js` | typescript/javascript | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | node-ts-reparse + container-sandbox |
| `telegram` | npm | `telegraf` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `terraform` | github-releases | `terraform` | hcl | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `trpc` | npm | `@trpc/server` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `twilio` | npm | `twilio` | typescript/javascript | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | node-ts-reparse + container-sandbox |
| `typeorm` | npm | `typeorm` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `vercel` | npm | `vercel` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |
| `vercel-ai-sdk` | npm | `ai` | typescript/javascript | `DRAFT_PR` | draft-PR | APPROVAL_REQUIRED | 2026-08-17 | 1.0.0 | node-ts-reparse + container-sandbox |
| `vue` | npm | `vue` | typescript/javascript | `ASSESS` | impact-analysis | PLAN_ONLY | — | — | — |

*64 rows — deterministic, regenerates with timestamp at build time only.*
