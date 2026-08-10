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

/** All enum arrays, used by the Prisma drift test. */
export const ALL_ENUMS = {
  Role,
  RepositoryProvider,
  RepositoryStatus,
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
  ApprovalDecision,
  ActorType,
  PolicyDecision,
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
