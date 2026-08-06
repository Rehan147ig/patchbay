import { z } from "zod";
import {
  ApprovalDecision,
  ChangeType,
  GenerationMethod,
  PolicyDecision,
  RepositoryProvider,
  RiskLevel,
  RiskTag,
  Severity,
  VendorChangeSource,
} from "./enums";

/**
 * Zod schemas for every API boundary input and every externally produced structured value
 * (e.g. AI provider output). Kept in `domain` so all packages validate against the same
 * contracts.
 */

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const repositoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  fullName: z.string().min(1).max(255),
  externalId: z.string().min(1).max(255).optional(),
  provider: z
    .enum([RepositoryProvider.GITHUB, RepositoryProvider.LOCAL])
    .default(RepositoryProvider.LOCAL),
  defaultBranch: z.string().min(1).max(100).default("main"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type RepositoryCreateRequest = z.infer<typeof repositoryCreateSchema>;

export const repositoryScanRequestSchema = z.object({});
export type RepositoryScanRequest = z.infer<typeof repositoryScanRequestSchema>;

export const vendorChangeCreateSchema = z.object({
  vendorSlug: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  externalReference: z.string().max(255).optional(),
  sourceType: z.enum([
    VendorChangeSource.MANUAL,
    VendorChangeSource.SDK_RELEASE,
    VendorChangeSource.OPENAPI_DIFF,
    VendorChangeSource.CHANGELOG,
    VendorChangeSource.WEBHOOK,
  ]),
  sourceUrl: z.string().url().max(2048).optional(),
  severity: z
    .enum([Severity.INFO, Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL])
    .default(Severity.MEDIUM),
  effectiveAt: z.string().datetime().optional(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
});
export type VendorChangeCreateRequest = z.infer<typeof vendorChangeCreateSchema>;

/** Body for the provider-agent ingest endpoint (POST /api/vendors/:slug/events). */
export const agentIngestSchema = z.object({
  externalReference: z.string().max(255).optional(),
  sourceType: z
    .enum([
      VendorChangeSource.MANUAL,
      VendorChangeSource.SDK_RELEASE,
      VendorChangeSource.OPENAPI_DIFF,
      VendorChangeSource.CHANGELOG,
      VendorChangeSource.WEBHOOK,
    ])
    .default(VendorChangeSource.SDK_RELEASE),
  sourceUrl: z.string().url().max(2048).optional(),
  severity: z
    .enum([Severity.INFO, Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL])
    .default(Severity.MEDIUM),
  rawPayload: z.record(z.string(), z.unknown()),
});
export type AgentIngestRequest = z.infer<typeof agentIngestSchema>;

export const openApiDiffRequestSchema = z.object({
  oldDocument: z.string().min(1),
  newDocument: z.string().min(1),
});
export type OpenApiDiffRequest = z.infer<typeof openApiDiffRequestSchema>;

export const policyCreateSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  definitionJson: z.record(z.string(), z.unknown()),
});
export type PolicyCreateRequest = z.infer<typeof policyCreateSchema>;

export const policyUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().min(1).max(100).optional(),
  definitionJson: z.record(z.string(), z.unknown()).optional(),
});
export type PolicyUpdateRequest = z.infer<typeof policyUpdateSchema>;

export const approvalSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type ApprovalRequest = z.infer<typeof approvalSchema>;

export const demoRunSchema = z.object({
  scenario: z.enum(["openai-migration", "auth0-config", "openapi-response-field"]),
});
export type DemoRunRequest = z.infer<typeof demoRunSchema>;

export const paginationSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Structured, validated output of an AI remediation-plan draft. Never contains commands. */
export const aiPlanDraftSchema = z.object({
  rationale: z.string().min(1).max(4000),
  steps: z
    .array(z.object({ description: z.string().min(1).max(500) }))
    .min(1)
    .max(20),
  confidence: z.number().int().min(0).max(100),
  requiresHumanReview: z.boolean(),
  riskLevel: z.enum([RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL]),
  riskTags: z
    .array(
      z.enum([
        RiskTag.PAYMENT,
        RiskTag.AUTH,
        RiskTag.PII,
        RiskTag.WEBHOOK,
        RiskTag.INFRASTRUCTURE,
        RiskTag.TEST_ONLY,
        RiskTag.OTHER,
      ]),
    )
    .max(10)
    .default([]),
  /** Optional suggested file edits. Advisory only - never applied without deterministic validation. */
  suggestedEdits: z
    .array(
      z.object({
        filePath: z.string().min(1).max(512),
        description: z.string().min(1).max(500),
        diff: z.string().max(20_000).optional(),
      }),
    )
    .max(20)
    .default([]),
  applicableChangeTypes: z
    .array(
      z.enum([
        ChangeType.OTHER,
        ChangeType.METHOD_RENAMED,
        ChangeType.METHOD_REMOVED,
        ChangeType.PARAMETER_RENAMED,
        ChangeType.PARAMETER_REMOVED,
        ChangeType.PARAMETER_REQUIRED,
        ChangeType.RESPONSE_FIELD_REMOVED,
        ChangeType.RESPONSE_FIELD_TYPE_CHANGED,
        ChangeType.ENDPOINT_REMOVED,
        ChangeType.AUTH_CHANGE,
        ChangeType.WEBHOOK_CHANGE,
        ChangeType.SDK_VERSION_UPGRADE,
        ChangeType.NEW_CAPABILITY,
      ]),
    )
    .default([]),
});
export type AiPlanDraft = z.infer<typeof aiPlanDraftSchema>;

export const policyDecisionResultSchema = z.object({
  decision: z.enum([
    PolicyDecision.ALLOW_PLAN_ONLY,
    PolicyDecision.ALLOW_VALIDATE,
    PolicyDecision.ALLOW_DRAFT_PR,
    PolicyDecision.REQUIRE_APPROVAL,
    PolicyDecision.DENY,
  ]),
  matchedPolicyIds: z.array(z.string()),
  reasons: z.array(z.string()),
  requiresHumanReview: z.boolean(),
});
export type PolicyDecisionResult = z.infer<typeof policyDecisionResultSchema>;

export const approvalDecisionSchema = z.enum([
  ApprovalDecision.APPROVED,
  ApprovalDecision.REJECTED,
]);
export type ApprovalDecisionValue = z.infer<typeof approvalDecisionSchema>;

/** Code excerpt stored with usages: bounded, sanitized. */
export const codeExcerptSchema = z.object({
  text: z.string().max(2_000),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
});
export type CodeExcerpt = z.infer<typeof codeExcerptSchema>;

export const generationMethodSchema = z.enum([
  GenerationMethod.RULE_BASED,
  GenerationMethod.AI_ASSISTED,
  GenerationMethod.MANUAL,
]);
export type GenerationMethodValue = z.infer<typeof generationMethodSchema>;
