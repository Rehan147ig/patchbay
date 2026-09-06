import { z } from "zod";

/**
 * Capability matrix vocabulary (Production Spec §2.2, WP1).
 *
 * Every connector declares the same seven dimensions instead of a single
 * vague "supported" label. These const objects are the single source of
 * truth; the Zod schemas enforce them at every boundary (API, registry,
 * policy engine, PR body). Values are SCREAMING_SNAKE strings so they
 * serialize identically to JSON, audit events, and (from WP2) Prisma enums.
 *
 * Deliberately NOT mirrored in Prisma yet: no table stores a matrix until
 * WP2's ContractSource/ConnectorCertification models land. A drift test
 * (capability-matrix.test.ts) pins every value so renames break loudly.
 */

export const ContractKind = {
  REST: "REST",
  GRAPHQL: "GRAPHQL",
  SDK: "SDK",
  MCP: "MCP",
  WEBHOOK: "WEBHOOK",
  ASYNC: "ASYNC",
  AUTH_CONFIG: "AUTH_CONFIG",
} as const;
export type ContractKind = (typeof ContractKind)[keyof typeof ContractKind];

export const DetectionMode = {
  PUSH: "PUSH",
  WEBHOOK: "WEBHOOK",
  POLL: "POLL",
  REGISTRY: "REGISTRY",
  CUSTOM_FEED: "CUSTOM_FEED",
  MANUAL: "MANUAL",
} as const;
export type DetectionMode = (typeof DetectionMode)[keyof typeof DetectionMode];

export const NormalizationMode = {
  RAW: "RAW",
  SCHEMA_DIFF: "SCHEMA_DIFF",
  SEMANTIC_DIFF: "SEMANTIC_DIFF",
  RELEASE_FACTS: "RELEASE_FACTS",
  EVENT_DIFF: "EVENT_DIFF",
  TOOL_SCHEMA_DIFF: "TOOL_SCHEMA_DIFF",
} as const;
export type NormalizationMode = (typeof NormalizationMode)[keyof typeof NormalizationMode];

export const AnalysisMode = {
  NONE: "NONE",
  TEXT: "TEXT",
  AST: "AST",
  GRAPH: "GRAPH",
  TYPE_CHECK: "TYPE_CHECK",
  GENERATED_CLIENT: "GENERATED_CLIENT",
  RUNTIME_TELEMETRY: "RUNTIME_TELEMETRY",
} as const;
export type AnalysisMode = (typeof AnalysisMode)[keyof typeof AnalysisMode];

export const RemediationMode = {
  NONE: "NONE",
  PLAN: "PLAN",
  DETERMINISTIC_PATCH: "DETERMINISTIC_PATCH",
  AI_PLAN: "AI_PLAN",
  AI_PATCH_PROPOSAL: "AI_PATCH_PROPOSAL",
} as const;
export type RemediationMode = (typeof RemediationMode)[keyof typeof RemediationMode];

export const ValidationMode = {
  NONE: "NONE",
  STATIC: "STATIC",
  TYPECHECK: "TYPECHECK",
  TESTS: "TESTS",
  SANDBOX: "SANDBOX",
  CUSTOMER_GATE: "CUSTOMER_GATE",
} as const;
export type ValidationMode = (typeof ValidationMode)[keyof typeof ValidationMode];

export const DeliveryMode = {
  REPORT: "REPORT",
  ISSUE: "ISSUE",
  DRAFT_PR: "DRAFT_PR",
  CHECK_RUN: "CHECK_RUN",
  COMMENT: "COMMENT",
} as const;
export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

export const CertificationState = {
  UNCERTIFIED: "UNCERTIFIED",
  ASSESS: "ASSESS",
  PLAN: "PLAN",
  DRAFT_PR: "DRAFT_PR",
  VALIDATED_DRAFT_PR: "VALIDATED_DRAFT_PR",
} as const;
export type CertificationState = (typeof CertificationState)[keyof typeof CertificationState];

/** Strict ordering: a higher rank subsumes every lower capability. */
const CERTIFICATION_RANK: Record<CertificationState, number> = {
  UNCERTIFIED: 0,
  ASSESS: 1,
  PLAN: 2,
  DRAFT_PR: 3,
  VALIDATED_DRAFT_PR: 4,
};

export function certificationAtLeast(
  actual: CertificationState,
  required: CertificationState,
): boolean {
  return CERTIFICATION_RANK[actual] >= CERTIFICATION_RANK[required];
}

/** A connector's declared capability: one value per dimension, no vague labels. */
export const capabilityMatrixSchema = z.object({
  contractKind: z.nativeEnum(ContractKind),
  detection: z.nativeEnum(DetectionMode),
  normalization: z.nativeEnum(NormalizationMode),
  analysis: z.nativeEnum(AnalysisMode),
  remediation: z.nativeEnum(RemediationMode),
  validation: z.nativeEnum(ValidationMode),
  delivery: z.nativeEnum(DeliveryMode),
  certification: z.nativeEnum(CertificationState),
  /** Schema version of this declaration; bumped only with a migration note. */
  matrixVersion: z.literal(1),
});

export type CapabilityMatrix = z.infer<typeof capabilityMatrixSchema>;

export const CAPABILITY_MATRIX_VERSION = 1 as const;

/** Parse (validating) a matrix from unknown input — API, registry, and policy boundaries. */
export function parseCapabilityMatrix(input: unknown): CapabilityMatrix {
  return capabilityMatrixSchema.parse(input);
}

/**
 * Canonical JSON serialization: Zod output key order is declaration order,
 * so the same matrix always serializes byte-identically (registry responses,
 * audit payloads, corpus fixtures).
 */
export function serializeCapabilityMatrix(matrix: CapabilityMatrix): string {
  return JSON.stringify(capabilityMatrixSchema.parse(matrix));
}

/** The full vocabulary for API serialization (GET /api/capability-matrix). */
export const CAPABILITY_VOCABULARY = {
  matrixVersion: CAPABILITY_MATRIX_VERSION,
  contractKinds: Object.values(ContractKind),
  detectionModes: Object.values(DetectionMode),
  normalizationModes: Object.values(NormalizationMode),
  analysisModes: Object.values(AnalysisMode),
  remediationModes: Object.values(RemediationMode),
  validationModes: Object.values(ValidationMode),
  deliveryModes: Object.values(DeliveryMode),
  certificationStates: Object.values(CertificationState),
} as const;
