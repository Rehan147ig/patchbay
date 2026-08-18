/**
 * Single source of truth for Patchbay's enum vocabulary.
 *
 * Values must stay in sync with `packages/db/prisma/schema.prisma`. The drift test in
 * `src/enums-drift.test.ts` enforces this.
 */

export const Role = {
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const RepositoryProvider = {
  GITHUB: "GITHUB",
  LOCAL: "LOCAL",
} as const;
export type RepositoryProvider = (typeof RepositoryProvider)[keyof typeof RepositoryProvider];

export const RepositoryStatus = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;
export type RepositoryStatus = (typeof RepositoryStatus)[keyof typeof RepositoryStatus];

export const PlanTier = {
  FREE: "FREE",
  PRO: "PRO",
  TEAM: "TEAM",
  ENTERPRISE: "ENTERPRISE",
} as const;
export type PlanTier = (typeof PlanTier)[keyof typeof PlanTier];

export const SubscriptionStatus = {
  TRIALING: "TRIALING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELED: "CANCELED",
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const ScanStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type ScanStatus = (typeof ScanStatus)[keyof typeof ScanStatus];

export const VendorChangeSource = {
  MANUAL: "MANUAL",
  SDK_RELEASE: "SDK_RELEASE",
  OPENAPI_DIFF: "OPENAPI_DIFF",
  CHANGELOG: "CHANGELOG",
  WEBHOOK: "WEBHOOK",
} as const;
export type VendorChangeSource = (typeof VendorChangeSource)[keyof typeof VendorChangeSource];

export const VendorChangeStatus = {
  DETECTED: "DETECTED",
  TRIAGED: "TRIAGED",
  REMEDIATION_STARTED: "REMEDIATION_STARTED",
  RESOLVED: "RESOLVED",
  IGNORED: "IGNORED",
} as const;
export type VendorChangeStatus = (typeof VendorChangeStatus)[keyof typeof VendorChangeStatus];

export const ChangeType = {
  SDK_VERSION_UPGRADE: "SDK_VERSION_UPGRADE",
  METHOD_RENAMED: "METHOD_RENAMED",
  METHOD_REMOVED: "METHOD_REMOVED",
  PARAMETER_RENAMED: "PARAMETER_RENAMED",
  PARAMETER_REMOVED: "PARAMETER_REMOVED",
  PARAMETER_REQUIRED: "PARAMETER_REQUIRED",
  RESPONSE_FIELD_REMOVED: "RESPONSE_FIELD_REMOVED",
  RESPONSE_FIELD_TYPE_CHANGED: "RESPONSE_FIELD_TYPE_CHANGED",
  ENDPOINT_REMOVED: "ENDPOINT_REMOVED",
  AUTH_CHANGE: "AUTH_CHANGE",
  WEBHOOK_CHANGE: "WEBHOOK_CHANGE",
  /** A newly launched capability worth adopting; not a break. */
  NEW_CAPABILITY: "NEW_CAPABILITY",
  OTHER: "OTHER",
} as const;
export type ChangeType = (typeof ChangeType)[keyof typeof ChangeType];

export const Severity = {
  INFO: "INFO",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const UsageType = {
  IMPORT: "IMPORT",
  INITIALIZATION: "INITIALIZATION",
  METHOD_CALL: "METHOD_CALL",
  ENDPOINT_CALL: "ENDPOINT_CALL",
  CONFIG: "CONFIG",
  WEBHOOK: "WEBHOOK",
  ENVIRONMENT_REFERENCE: "ENVIRONMENT_REFERENCE",
} as const;
export type UsageType = (typeof UsageType)[keyof typeof UsageType];

export const RiskTag = {
  PAYMENT: "PAYMENT",
  AUTH: "AUTH",
  PII: "PII",
  WEBHOOK: "WEBHOOK",
  INFRASTRUCTURE: "INFRASTRUCTURE",
  TEST_ONLY: "TEST_ONLY",
  OTHER: "OTHER",
} as const;
export type RiskTag = (typeof RiskTag)[keyof typeof RiskTag];

export const RiskLevel = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const ImpactStatus = {
  NOT_AFFECTED: "NOT_AFFECTED",
  POSSIBLY_AFFECTED: "POSSIBLY_AFFECTED",
  AFFECTED: "AFFECTED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
} as const;
export type ImpactStatus = (typeof ImpactStatus)[keyof typeof ImpactStatus];

export const PlanStatus = {
  DRAFT: "DRAFT",
  READY_FOR_VALIDATION: "READY_FOR_VALIDATION",
  VALIDATING: "VALIDATING",
  VALIDATED: "VALIDATED",
  BLOCKED: "BLOCKED",
  PR_CREATED: "PR_CREATED",
  FAILED: "FAILED",
} as const;
export type PlanStatus = (typeof PlanStatus)[keyof typeof PlanStatus];

export const GenerationMethod = {
  RULE_BASED: "RULE_BASED",
  AI_ASSISTED: "AI_ASSISTED",
  MANUAL: "MANUAL",
} as const;
export type GenerationMethod = (typeof GenerationMethod)[keyof typeof GenerationMethod];

export const ValidationStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  PASSED: "PASSED",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type ValidationStatus = (typeof ValidationStatus)[keyof typeof ValidationStatus];

export const PullRequestStatus = {
  DRAFT: "DRAFT",
  OPEN: "OPEN",
  MERGED: "MERGED",
  CLOSED: "CLOSED",
} as const;
export type PullRequestStatus = (typeof PullRequestStatus)[keyof typeof PullRequestStatus];

export const PrOutcomeStatus = {
  OPEN: "OPEN",
  MERGED: "MERGED",
  CLOSED: "CLOSED",
} as const;
export type PrOutcomeStatus = (typeof PrOutcomeStatus)[keyof typeof PrOutcomeStatus];

/**
 * Human- and machine-verifiable verdict for a remediation PR.
 * UNCLASSIFIED is the initial state set by webhook ingestion; the rest are
 * user feedback / system attribution categories.
 */
export const PrOutcomeClassification = {
  SUCCESS: "SUCCESS",
  WRONG_IMPACT: "WRONG_IMPACT",
  WRONG_PATCH: "WRONG_PATCH",
  INSUFFICIENT_TESTS: "INSUFFICIENT_TESTS",
  VALIDATION_FAILURE: "VALIDATION_FAILURE",
  MANUAL_EDITS: "MANUAL_EDITS",
  POLICY_PREFERENCE: "POLICY_PREFERENCE",
  UNCLASSIFIED: "UNCLASSIFIED",
} as const;
export type PrOutcomeClassification =
  (typeof PrOutcomeClassification)[keyof typeof PrOutcomeClassification];

export const OutcomeSource = {
  GITHUB_WEBHOOK: "GITHUB_WEBHOOK",
  USER_FEEDBACK: "USER_FEEDBACK",
  SYSTEM: "SYSTEM",
} as const;
export type OutcomeSource = (typeof OutcomeSource)[keyof typeof OutcomeSource];

export const CapabilityGateStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type CapabilityGateStatus = (typeof CapabilityGateStatus)[keyof typeof CapabilityGateStatus];

export const ApprovalDecision = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

export const ActorType = {
  USER: "USER",
  SYSTEM: "SYSTEM",
  AGENT: "AGENT",
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];

export const PolicyDecision = {
  ALLOW_PLAN_ONLY: "ALLOW_PLAN_ONLY",
  ALLOW_VALIDATE: "ALLOW_VALIDATE",
  ALLOW_DRAFT_PR: "ALLOW_DRAFT_PR",
  REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
  DENY: "DENY",
} as const;
export type PolicyDecision = (typeof PolicyDecision)[keyof typeof PolicyDecision];

export const TaskStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const GraphSnapshotStatus = {
  INDEXING: "INDEXING",
  READY: "READY",
  FAILED: "FAILED",
} as const;
export type GraphSnapshotStatus = (typeof GraphSnapshotStatus)[keyof typeof GraphSnapshotStatus];

export const GraphIndexMode = {
  BASELINE: "BASELINE",
  INCREMENTAL: "INCREMENTAL",
} as const;
export type GraphIndexMode = (typeof GraphIndexMode)[keyof typeof GraphIndexMode];

export const GraphNodeKind = {
  REPOSITORY: "REPOSITORY",
  FILE: "FILE",
  MODULE: "MODULE",
  SYMBOL: "SYMBOL",
  FUNCTION: "FUNCTION",
  CLASS: "CLASS",
  DEPENDENCY: "DEPENDENCY",
  PACKAGE: "PACKAGE",
  API_CLIENT: "API_CLIENT",
  API_OPERATION: "API_OPERATION",
  CONFIGURATION_KEY: "CONFIGURATION_KEY",
  TEST: "TEST",
  SERVICE: "SERVICE",
  QUEUE_TOPIC: "QUEUE_TOPIC",
  DATABASE: "DATABASE",
} as const;
export type GraphNodeKind = (typeof GraphNodeKind)[keyof typeof GraphNodeKind];

/**
 * Edge kinds for the software intelligence graph.
 *
 * Every edge kind has an associated provenance class (EXTRACTED, RESOLVED, INFERRED)
 * and is classified as stable (structural; safe for automated change) or volatile
 * (dependency/release-sensitive; require human review before automated patch
 * application). The classification is exposed via `StableEdgeKinds`/`VolatileEdgeKinds`.
 */
export const GraphEdgeKind = {
  CONTAINS: "CONTAINS",
  EXPORTS: "EXPORTS",
  IMPORTS: "IMPORTS",
  CALLS: "CALLS",
  EXTENDS: "EXTENDS",
  DECLARES: "DECLARES",
  RESOLVES_TO: "RESOLVES_TO",
  USES_PACKAGE: "USES_PACKAGE",
  AFFECTED_BY: "AFFECTED_BY",
  CREATES_CLIENT: "CREATES_CLIENT",
  INVOKES_API: "INVOKES_API",
  READS_CONFIG: "READS_CONFIG",
  TESTS: "TESTS",
  BELONGS_TO_SERVICE: "BELONGS_TO_SERVICE",
  PUBLISHES: "PUBLISHES",
  CONSUMES: "CONSUMES",
  ACCESSES: "ACCESSES",
  /** Service configures a database (connection, schema, migrations). */
  CONFIGURES: "CONFIGURES",
  /** Service uses a database. */
  USES: "USES",
  /** Database provides a service. */
  PROVIDES: "PROVIDES",
  /** Queue topic is accessed by a service. */
  QUEUE_TOPIC: "QUEUE_TOPIC",
} as const;
export type GraphEdgeKind = (typeof GraphEdgeKind)[keyof typeof GraphEdgeKind];

export const GraphProvenance = {
  EXTRACTED: "EXTRACTED",
  RESOLVED: "RESOLVED",
  INFERRED: "INFERRED",
  AMBIGUOUS: "AMBIGUOUS",
} as const;
export type GraphProvenance = (typeof GraphProvenance)[keyof typeof GraphProvenance];

export const ReleaseSource = {
  NPM: "NPM",
  GITHUB_RELEASE: "GITHUB_RELEASE",
  OPENAPI: "OPENAPI",
  VENDOR_MANIFEST: "VENDOR_MANIFEST",
  CHANGELOG: "CHANGELOG",
} as const;
export type ReleaseSource = (typeof ReleaseSource)[keyof typeof ReleaseSource];

export const ReleaseAuthenticity = {
  VERIFIED: "VERIFIED",
  SOURCE_TRUSTED: "SOURCE_TRUSTED",
  UNVERIFIED: "UNVERIFIED",
} as const;
export type ReleaseAuthenticity = (typeof ReleaseAuthenticity)[keyof typeof ReleaseAuthenticity];

export const ReleaseStatus = {
  OBSERVED: "OBSERVED",
  CLASSIFIED: "CLASSIFIED",
  FAILED: "FAILED",
} as const;
export type ReleaseStatus = (typeof ReleaseStatus)[keyof typeof ReleaseStatus];

export const ReleaseMatchStatus = {
  CANDIDATE: "CANDIDATE",
  NOT_RELEVANT: "NOT_RELEVANT",
  MONITOR: "MONITOR",
  REVIEW: "REVIEW",
  REMEDIATE: "REMEDIATE",
} as const;
export type ReleaseMatchStatus = (typeof ReleaseMatchStatus)[keyof typeof ReleaseMatchStatus];

export const DetectionRunStatus = {
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type DetectionRunStatus = (typeof DetectionRunStatus)[keyof typeof DetectionRunStatus];

export const ReleaseClassificationMethod = {
  DETERMINISTIC: "DETERMINISTIC",
  AI: "AI",
  MANUAL: "MANUAL",
} as const;
export type ReleaseClassificationMethod =
  (typeof ReleaseClassificationMethod)[keyof typeof ReleaseClassificationMethod];

export const AgentRunType = {
  PLAN_GENERATION: "PLAN_GENERATION",
  PLAN_REVIEW: "PLAN_REVIEW",
} as const;
export type AgentRunType = (typeof AgentRunType)[keyof typeof AgentRunType];

export const AgentRunStatus = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
} as const;
export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

export const AgentRole = {
  ANALYST: "ANALYST",
  PLANNER: "PLANNER",
  REVIEWER: "REVIEWER",
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const AgentStepKind = {
  WORKFLOW: "WORKFLOW",
  TOOL_CALL: "TOOL_CALL",
  MODEL_CALL: "MODEL_CALL",
} as const;
export type AgentStepKind = (typeof AgentStepKind)[keyof typeof AgentStepKind];

export const AgentStepStatus = {
  STARTED: "STARTED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type AgentStepStatus = (typeof AgentStepStatus)[keyof typeof AgentStepStatus];

/**
 * Remediation case lifecycle (control-plane funnel, WP3). Transitions are
 * tenant-scoped, idempotent, audited and explicit; a case can never skip
 * policy or validation via a retry or direct API call.
 */
export const CaseStatus = {
  OBSERVED: "OBSERVED",
  EVIDENCE_VERIFIED: "EVIDENCE_VERIFIED",
  IMPACT_CONFIRMED: "IMPACT_CONFIRMED",
  POLICY_ELIGIBLE: "POLICY_ELIGIBLE",
  PLANNING: "PLANNING",
  PATCH_PROPOSED: "PATCH_PROPOSED",
  VALIDATING: "VALIDATING",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  DRAFT_PR_CREATED: "DRAFT_PR_CREATED",
  PLAN_ONLY: "PLAN_ONLY",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
  MERGED: "MERGED",
  CLOSED: "CLOSED",
  LEARNED: "LEARNED",
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

/** Terminal states: no further transition without an explicit replay action. */
export const CASE_TERMINAL_STATUSES: ReadonlySet<CaseStatus> = new Set([
  CaseStatus.REJECTED,
  CaseStatus.CANCELLED,
  CaseStatus.MERGED,
  CaseStatus.CLOSED,
  CaseStatus.LEARNED,
]);

/**
 * Why a case exists or was stopped. Cases that cannot proceed (unsupported
 * capability, policy denial, insufficient evidence) stay visible at
 * IMPACT_CONFIRMED and never spend model budget.
 */
export const CaseReasonCode = {
  DEPENDENCY_MATCH: "dependency-match",
  USAGE_EVIDENCE: "usage-evidence",
  CAPABILITY_UNSUPPORTED: "capability-unsupported",
  POLICY_DENIED: "policy-denied",
  INSUFFICIENT_EVIDENCE: "insufficient-evidence",
  USER_REQUESTED: "user-requested",
  APPROVED: "approved",
  REPLAYED: "replayed",
  REJECTED_BY_OWNER: "rejected-by-owner",
  CANCELLED: "cancelled",
} as const;
export type CaseReasonCode = (typeof CaseReasonCode)[keyof typeof CaseReasonCode];

/** Terminal outcomes recorded on a case when it finishes. */
export const CaseTerminalOutcome = {
  CANCELLED: "cancelled",
  REJECTED: "rejected",
  MERGED: "merged",
  CLOSED: "closed",
  LEARNED: "learned",
} as const;
export type CaseTerminalOutcome = (typeof CaseTerminalOutcome)[keyof typeof CaseTerminalOutcome];

/** All enum arrays, used by the Prisma drift test. */
export const ALL_ENUMS = {
  Role,
  RepositoryProvider,
  RepositoryStatus,
  PlanTier,
  SubscriptionStatus,
  ScanStatus,
  VendorChangeSource,
  VendorChangeStatus,
  ChangeType,
  Severity,
  UsageType,
  RiskTag,
  RiskLevel,
  ImpactStatus,
  PlanStatus,
  GenerationMethod,
  ValidationStatus,
  PullRequestStatus,
  PrOutcomeStatus,
  PrOutcomeClassification,
  OutcomeSource,
  CapabilityGateStatus,
  ApprovalDecision,
  ActorType,
  PolicyDecision,
  ReleaseSource,
  ReleaseAuthenticity,
  ReleaseStatus,
  ReleaseMatchStatus,
  DetectionRunStatus,
  ReleaseClassificationMethod,
  AgentRunType,
  AgentRunStatus,
  AgentRole,
  AgentStepKind,
  AgentStepStatus,
  CaseStatus,
  TaskStatus,
  GraphSnapshotStatus,
  GraphIndexMode,
  GraphNodeKind,
  GraphEdgeKind,
  GraphProvenance,
} as const;

/** Confidence/impact scoring thresholds (shared by engines, policy, and UI). */
export const SCORING = {
  /** Below this confidence: plan only, no patch. */
  CONFIDENCE_MIN_PATCH: 70,
  /** At or above this confidence and no high-risk tags: draft PR allowed by default policy. */
  CONFIDENCE_DRAFT_PR: 85,
  /** High-risk tags force REQUIRE_APPROVAL regardless of confidence. */
  HIGH_RISK_APPROVAL_TAGS: [
    RiskTag.PAYMENT,
    RiskTag.AUTH,
    RiskTag.PII,
    RiskTag.WEBHOOK,
    RiskTag.INFRASTRUCTURE,
  ] as const,
} as const;

/**
 * Stable edge kinds — structural facts safe for automated change without human review.
 * Together with `VolatileEdgeKinds` they partition `GraphEdgeKind`.
 */
export const StableEdgeKinds: ReadonlySet<GraphEdgeKind> = new Set([
  GraphEdgeKind.CONTAINS,
  GraphEdgeKind.EXPORTS,
  GraphEdgeKind.IMPORTS,
  GraphEdgeKind.CALLS,
  GraphEdgeKind.EXTENDS,
  GraphEdgeKind.CREATES_CLIENT,
  GraphEdgeKind.INVOKES_API,
  GraphEdgeKind.READS_CONFIG,
  GraphEdgeKind.TESTS,
  GraphEdgeKind.BELONGS_TO_SERVICE,
  GraphEdgeKind.PUBLISHES,
  GraphEdgeKind.CONSUMES,
  GraphEdgeKind.CONFIGURES,
  GraphEdgeKind.USES,
  GraphEdgeKind.PROVIDES,
  GraphEdgeKind.QUEUE_TOPIC,
  GraphEdgeKind.ACCESSES,
]);

/**
 * Volatile edge kinds — dependency and release-sensitive facts that change when a
 * vendor ships a new version; require human review before automated patch application.
 * Together with `StableEdgeKinds` they partition `GraphEdgeKind`.
 */
export const VolatileEdgeKinds: ReadonlySet<GraphEdgeKind> = new Set([
  GraphEdgeKind.DECLARES,
  GraphEdgeKind.RESOLVES_TO,
  GraphEdgeKind.USES_PACKAGE,
  GraphEdgeKind.AFFECTED_BY,
]);
