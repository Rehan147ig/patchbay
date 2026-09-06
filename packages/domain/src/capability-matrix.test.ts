import { describe, expect, it } from "vitest";
import {
  CAPABILITY_MATRIX_VERSION,
  CAPABILITY_VOCABULARY,
  CertificationState,
  certificationAtLeast,
  ContractKind,
  DeliveryMode,
  DetectionMode,
  NormalizationMode,
  AnalysisMode,
  RemediationMode,
  ValidationMode,
  parseCapabilityMatrix,
  serializeCapabilityMatrix,
  type CapabilityMatrix,
} from "./capability-matrix";

/**
 * WP1 drift guard: the §2.2 capability vocabulary is a cross-system contract
 * (API, registry, policy engine, PR body, and from WP2 the database). Any
 * rename, removal, or reorder must break loudly here — never drift silently
 * into a certification mismatch.
 */
describe("capability vocabulary stability", () => {
  it("pins the exact contract kinds", () => {
    expect(Object.values(ContractKind)).toEqual([
      "REST",
      "GRAPHQL",
      "SDK",
      "MCP",
      "WEBHOOK",
      "ASYNC",
      "AUTH_CONFIG",
    ]);
  });

  it("pins every dimension's exact values", () => {
    expect(Object.values(DetectionMode)).toEqual([
      "PUSH",
      "WEBHOOK",
      "POLL",
      "REGISTRY",
      "CUSTOM_FEED",
      "MANUAL",
    ]);
    expect(Object.values(NormalizationMode)).toEqual([
      "RAW",
      "SCHEMA_DIFF",
      "SEMANTIC_DIFF",
      "RELEASE_FACTS",
      "EVENT_DIFF",
      "TOOL_SCHEMA_DIFF",
    ]);
    expect(Object.values(AnalysisMode)).toEqual([
      "NONE",
      "TEXT",
      "AST",
      "GRAPH",
      "TYPE_CHECK",
      "GENERATED_CLIENT",
      "RUNTIME_TELEMETRY",
    ]);
    expect(Object.values(RemediationMode)).toEqual([
      "NONE",
      "PLAN",
      "DETERMINISTIC_PATCH",
      "AI_PLAN",
      "AI_PATCH_PROPOSAL",
    ]);
    expect(Object.values(ValidationMode)).toEqual([
      "NONE",
      "STATIC",
      "TYPECHECK",
      "TESTS",
      "SANDBOX",
      "CUSTOMER_GATE",
    ]);
    expect(Object.values(DeliveryMode)).toEqual([
      "REPORT",
      "ISSUE",
      "DRAFT_PR",
      "CHECK_RUN",
      "COMMENT",
    ]);
    expect(Object.values(CertificationState)).toEqual([
      "UNCERTIFIED",
      "ASSESS",
      "PLAN",
      "DRAFT_PR",
      "VALIDATED_DRAFT_PR",
    ]);
  });

  it("orders certification strictly from UNCERTIFIED to VALIDATED_DRAFT_PR", () => {
    const states = Object.values(CertificationState);
    for (let index = 0; index < states.length; index += 1) {
      for (let other = 0; other < states.length; other += 1) {
        expect(certificationAtLeast(states[index]!, states[other]!)).toBe(index >= other);
      }
    }
  });
});

describe("capability matrix serialization", () => {
  const openai: CapabilityMatrix = {
    contractKind: "SDK",
    detection: "POLL",
    normalization: "RELEASE_FACTS",
    analysis: "GRAPH",
    remediation: "DETERMINISTIC_PATCH",
    validation: "SANDBOX",
    delivery: "DRAFT_PR",
    certification: "DRAFT_PR",
    matrixVersion: 1,
  };

  it("round-trips byte-identically (registry, audit, and fixture safe)", () => {
    const once = serializeCapabilityMatrix(openai);
    const twice = serializeCapabilityMatrix(parseCapabilityMatrix(JSON.parse(once)));
    expect(twice).toBe(once);
    expect(JSON.parse(once)).toEqual(openai);
  });

  it("rejects unknown dimension values instead of coercing them", () => {
    expect(() => parseCapabilityMatrix({ ...openai, delivery: "PULL_REQUEST" })).toThrow();
    expect(() => parseCapabilityMatrix({ ...openai, matrixVersion: 2 })).toThrow();
    expect(() => parseCapabilityMatrix({ ...openai, certification: undefined })).toThrow();
  });

  it("exposes the full vocabulary for API serialization", () => {
    expect(CAPABILITY_VOCABULARY.matrixVersion).toBe(CAPABILITY_MATRIX_VERSION);
    expect(CAPABILITY_VOCABULARY.contractKinds).toContain("MCP");
    expect(CAPABILITY_VOCABULARY.deliveryModes).toContain("CHECK_RUN");
    expect(CAPABILITY_VOCABULARY.certificationStates).toHaveLength(5);
  });
});
