# ADR-0008: AI provider abstraction with deterministic mock default

Status: accepted

## Context

AI adds interpretive value but must never be required, leak secrets, or act outside policy.

## Decision

- Narrow `AiProvider` interface (`draftRemediationPlan`) with Zod-validated structured output.
- `MockAiProvider` is the default: deterministic fixture plans, no network, powers the whole demo.
- `OpenAiCompatibleProvider` optional behind env vars; prompts are files in
  `packages/ai-provider/prompts/`; context is redacted and size-bounded.
- AI output cannot contain commands to execute and cannot create patches without deterministic
  rule matches.

## Consequences

- Demo runs offline and tests are deterministic.
- Prompt injection surface is bounded and documented (threats T3, T7).
