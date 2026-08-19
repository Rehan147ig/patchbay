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

/**
 * Body for the uniform submission endpoint (POST /api/submission).
 *
 * A submission is an idempotent request to create or refresh a task parameter
 * (taskId + type identify it); retries overwrite inputs, never duplicate.
 * `domain` scopes the executor that will process it (only "NPM" is wired today);
 * `input` is opaque but bounded and passed through to the task output.
 */
export const submissionSchema = z.object({
  taskId: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  domain: z.enum(["NPM", "GITHUB_RELEASE", "OPENAPI", "VENDOR_MANIFEST", "CHANGELOG"]),
  input: z.record(z.string(), z.unknown()).optional(),
  deadline: z.string().datetime().optional(),
});
export type SubmissionRequest = z.infer<typeof submissionSchema>;

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
  scenario: z.enum([
    "openai-migration",
    "auth0-config",
    "openapi-response-field",
    "stripe-metadata",
    "anthropic-completions",
    "aws-sdk-v2-clients",
    "supabase-auth-user",
  ]),
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

// ---------------------------------------------------------------------------
// Agent Harness (Phases H3-H4): typed, bounded PatchPlan contract.
// The plan is a PROPOSAL: it carries source-hash-bound edits and preconditions.
// Nothing here is executable; the deterministic engine applies and validates
// edits later, and any mismatch invalidates the whole plan.
// ---------------------------------------------------------------------------

export const patchPlanEditOperationSchema = z.enum(["REPLACE", "INSERT_AFTER", "DELETE"]);

export const patchPlanEditSchema = z.object({
  filePath: z.string().min(1).max(512),
  /** sha256 of the file content the edit expects; mismatches invalidate the plan. */
  expectedSourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  operation: patchPlanEditOperationSchema,
  /** Exact text to anchor the edit (REPLACE/INSERT_AFTER). Bounded, never regex. */
  searchText: z.string().min(1).max(4000).optional(),
  replacement: z.string().max(4000).optional(),
  /** Human-readable AST/precondition check description (e.g. "caller expression is a member call"). */
  precondition: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(500),
  confidence: z.number().int().min(0).max(100),
});
export type PatchPlanEdit = z.infer<typeof patchPlanEditSchema>;

/** Plan-only proposal from the planner. Bound by the schema; edits ≤ 50. */
export const patchPlanSchema = z.object({
  releaseRecordId: z.string().min(1),
  repositoryId: z.string().min(1),
  expectedCommitSha: z.string().max(200).optional(),
  rationale: z.string().min(1).max(4000),
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
  edits: z.array(patchPlanEditSchema).min(0).max(50),
  validationProfile: z
    .array(z.enum(["typecheck", "test", "lint"]))
    .max(5)
    .default([]),
  /** Change drafts this plan addresses (affected symbols), for reviewer alignment. */
  addressedSymbols: z.array(z.string().min(1).max(200)).max(200).default([]),
});
export type PatchPlan = z.infer<typeof patchPlanSchema>;

/** Bounded context handed to the planner: trusted release facts + graph evidence only. */
export const patchGenerationInputSchema = z.object({
  releaseRecordId: z.string().min(1),
  repositoryId: z.string().min(1),
  expectedCommitSha: z.string().max(200).optional(),
  vendorSlug: z.string().min(1).max(100),
  packageName: z.string().min(1).max(100),
  fromVersion: z.string().max(50).nullable(),
  toVersion: z.string().max(50),
  breaking: z.boolean(),
  resolvedVersion: z.string().max(50).nullable(),
  declaredRange: z.string().max(200).nullable(),
  /** Change drafts produced by deterministic classification (with rule attribution). */
  drafts: z
    .array(
      z.object({
        changeType: z.string().min(1).max(100),
        oldValue: z.string().max(500).nullable(),
        newValue: z.string().max(500).nullable(),
        description: z.string().max(1000).nullable(),
        breaking: z.boolean(),
        affectedSymbols: z.array(z.string().min(1).max(200)).max(50).default([]),
        rule: z.string().max(200).nullable(),
      }),
    )
    .max(30)
    .default([]),
  /** Bounded graph evidence: every using module with its edge kinds. */
  modules: z
    .array(
      z.object({
        filePath: z.string().min(1).max(512),
        edgeKinds: z.array(z.string().min(1).max(100)).max(10).default([]),
        evidenceCount: z.number().int().min(0).max(10_000),
      }),
    )
    .max(200)
    .default([]),
});
export type PatchGenerationInput = z.infer<typeof patchGenerationInputSchema>;

/** Independent reviewer verdict: compares release evidence, plan edits, and optional validation evidence. */
export const reviewVerdictSchema = z.object({
  approved: z.boolean(),
  independent: z.literal(true),
  confidence: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(2000),
  issues: z
    .array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        target: z.enum(["plan", "evidence", "validation"]),
        message: z.string().min(1).max(1000),
      }),
    )
    .max(20)
    .default([]),
});
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

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
