import type { BadgeTone, StatusPillProps } from "@patchbay/ui";
import {
  ImpactStatus,
  PlanStatus,
  PullRequestStatus,
  RiskLevel,
  ScanStatus,
  Severity,
  ValidationStatus,
  VendorChangeSource,
  VendorChangeStatus,
  type ChangeType,
  type RiskTag,
} from "@patchbay/domain";

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateOnly(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function scoreTone(score: number): "neutral" | "green" | "amber" | "red" {
  if (score >= 85) return "green";
  if (score >= 70) return "amber";
  return "red";
}

export const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  INFO: "slate",
  LOW: "blue",
  MEDIUM: "amber",
  HIGH: "red",
  CRITICAL: "red",
};

export const CHANGE_STATUS_TONE: Record<VendorChangeStatus, StatusPillProps["tone"]> = {
  DETECTED: "blue",
  TRIAGED: "amber",
  REMEDIATION_STARTED: "purple",
  RESOLVED: "green",
  IGNORED: "neutral",
};

export const SCAN_STATUS_TONE: Record<ScanStatus, StatusPillProps["tone"]> = {
  QUEUED: "neutral",
  RUNNING: "blue",
  COMPLETED: "green",
  FAILED: "red",
};

export const IMPACT_STATUS_TONE: Record<ImpactStatus, StatusPillProps["tone"]> = {
  NOT_AFFECTED: "green",
  POSSIBLY_AFFECTED: "amber",
  AFFECTED: "red",
  NEEDS_REVIEW: "purple",
};

export const PLAN_STATUS_TONE: Record<PlanStatus, StatusPillProps["tone"]> = {
  DRAFT: "neutral",
  READY_FOR_VALIDATION: "blue",
  VALIDATING: "blue",
  VALIDATED: "green",
  BLOCKED: "red",
  PR_CREATED: "green",
  FAILED: "red",
};

export const VALIDATION_STATUS_TONE: Record<ValidationStatus, StatusPillProps["tone"]> = {
  QUEUED: "neutral",
  RUNNING: "blue",
  PASSED: "green",
  FAILED: "red",
  SKIPPED: "neutral",
};

export const PR_STATUS_TONE: Record<PullRequestStatus, StatusPillProps["tone"]> = {
  DRAFT: "purple",
  OPEN: "blue",
  MERGED: "green",
  CLOSED: "neutral",
};

export const RISK_LEVEL_TONE: Record<RiskLevel, BadgeTone> = {
  LOW: "green",
  MEDIUM: "amber",
  HIGH: "red",
  CRITICAL: "red",
};

export const SOURCE_TYPE_LABEL: Record<VendorChangeSource, string> = {
  MANUAL: "Manual",
  SDK_RELEASE: "SDK release",
  OPENAPI_DIFF: "OpenAPI diff",
  CHANGELOG: "Changelog",
  WEBHOOK: "Webhook",
};

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  SDK_VERSION_UPGRADE: "SDK version upgrade",
  METHOD_RENAMED: "Method renamed",
  METHOD_REMOVED: "Method removed",
  PARAMETER_RENAMED: "Parameter renamed",
  PARAMETER_REMOVED: "Parameter removed",
  PARAMETER_REQUIRED: "Parameter now required",
  RESPONSE_FIELD_REMOVED: "Response field removed",
  RESPONSE_FIELD_TYPE_CHANGED: "Response field type changed",
  ENDPOINT_REMOVED: "Endpoint removed",
  AUTH_CHANGE: "Auth change",
  WEBHOOK_CHANGE: "Webhook change",
  NEW_CAPABILITY: "New capability",
  OTHER: "Other",
};

export const RISK_TAG_LABEL: Record<RiskTag, string> = {
  PAYMENT: "payment",
  AUTH: "auth",
  PII: "pii",
  WEBHOOK: "webhook",
  INFRASTRUCTURE: "infrastructure",
  TEST_ONLY: "test-only",
  OTHER: "other",
};

export const RISK_TAG_TONE: Record<RiskTag, BadgeTone> = {
  PAYMENT: "red",
  AUTH: "red",
  PII: "purple",
  WEBHOOK: "amber",
  INFRASTRUCTURE: "blue",
  TEST_ONLY: "green",
  OTHER: "neutral",
};

export function truncate(value: string, max = 120): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
